'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PurchaseType, Product, ProductRegion } from '@/types/database'
import { isCanaryIslands } from '@/lib/utils'
import { fieldRequirementsFor } from '@/lib/order-requirements'
import {
  isFreePrice,
  needsCustomName,
  missingNameError,
  missingPriceError,
} from '@/lib/product-rules'
import type { CartLineState } from '@/components/orders/CartLine'
import CartSummary from '@/components/orders/CartSummary'
import Step2Catalog from '@/components/orders/Step2Catalog'
import FinancingCatalog from '@/components/orders/FinancingCatalog'
import FinancingSummary from '@/components/orders/FinancingSummary'
import { isFinanceableCode } from '@/lib/financing'
import { SELECTION_PARAM, parseCatalogPicks } from '@/lib/catalog/order-link'
import { applyAddProduct } from '@/lib/catalog/rules'
import {
  allocateStock,
  clampToStock,
  guardStockChange,
  productStockState,
  toStockLines,
  validateStock,
  type StockView,
} from '@/lib/stock/compute'
import StockNotice from '@/components/orders/StockNotice'
import BankReceiptInput from '@/components/orders/BankReceiptInput'
import WizardSteps from '@/components/orders/WizardSteps'
import PurchaseTypeTile, {
  PURCHASE_TYPE_ORDER,
} from '@/components/orders/PurchaseTypeTile'
import OrderReviewModal from '@/components/orders/OrderReviewModal'

// =============================================================
// Wizard de creacion de pedido manual.
//
// Paso 1: tipo de compra (tiles visuales). Condiciona obligatoriedad
//         del resto de campos (transferencias_saas = sin envio).
// Paso 2: catálogo visual de productos + resumen (con descuento
//         global). El IVA aún no puede aplicarse por CP porque la
//         dirección se pide en paso 3 — el preview usa 21 % por
//         defecto y el servidor recalcula al insertar.
// Paso 3: datos del solicitante + cliente + refs + envío condicional.
//         Al pulsar "Crear pedido" se muestra un popup de revisión
//         final con el resumen completo antes del POST.
// =============================================================

interface FormData {
  requester_name: string
  requester_email: string
  customer_name: string
  venue_name: string
  contact_email: string
  phone: string
  purchase_type: PurchaseType | ''
  hubspot_ref: string
  bank_receipt_url: string
  shipping_street: string
  shipping_cp: string
  shipping_city: string
  shipping_province: string
  notes: string
}

const EMPTY_FORM: FormData = {
  requester_name: '',
  requester_email: '',
  customer_name: '',
  venue_name: '',
  contact_email: '',
  phone: '',
  purchase_type: '',
  hubspot_ref: '',
  bank_receipt_url: '',
  shipping_street: '',
  shipping_cp: '',
  shipping_city: '',
  shipping_province: '',
  notes: '',
}

type StepNum = 1 | 2 | 3

export default function NewOrderPage() {
  const router = useRouter()
  const [step, setStep] = useState<StepNum>(1)
  const [furthestReached, setFurthestReached] = useState<StepNum>(1)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  // Carrito vacío: las líneas se añaden vía tile del catálogo (estándar) o
  // botón "Añadir línea libre" (otro / saas_hardware). Sin placeholder inicial.
  const [items, setItems] = useState<CartLineState[]>([])
  // Descuento global (%) sobre la base imponible del pedido, adicional a
  // los descuentos por línea. Se aplica solo cuando purchase_type NO es
  // 'hardware_financiacion' (el plan de plazos es fijo).
  const [discountGlobalPct, setDiscountGlobalPct] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Popup de revisión final antes de crear el pedido.
  const [showReview, setShowReview] = useState(false)
  /**
   * Región del pedido, elegida en el paso 2. El CP se pide en el paso 3, así
   * que sin esto el catálogo no sabría qué lista de precios mostrar y se
   * podrían mezclar SKU peninsulares y canarios (el servidor lo rechaza, pero
   * descubrirlo al confirmar sería el peor momento).
   */
  const [region, setRegion] = useState<ProductRegion>('peninsula')
  /**
   * Stock de este usuario (lib/stock). Un no-admin no puede subir unidades
   * por encima de lo pedible; un admin lo ve pero no tiene tope. El servidor
   * vuelve a comprobarlo al crear el pedido.
   */
  const [stock, setStock] = useState<StockView | null>(null)
  const [stockNotice, setStockNotice] = useState<string | null>(null)

  useEffect(() => {
    async function loadCatalog() {
      try {
        const res = await fetch('/api/products')
        const data = await res.json()
        if (!res.ok) {
          setCatalogError(data.error ?? 'Error al cargar el catálogo.')
          return
        }
        setProducts(data.products ?? [])
        setStock(data.stock ?? null)
      } catch {
        setCatalogError('Error de conexión al cargar el catálogo.')
      } finally {
        setLoadingCatalog(false)
      }
    }
    loadCatalog()
  }, [])

  // ---------------------------------------------------------------
  // Puente desde /catalogo: ?sel=code:qty,...
  //
  // Se aplica DESPUES de que resuelva el catalogo, porque los picks vienen
  // por `code` y CartLineState referencia `product_id`, asi que el mapeo
  // necesita la lista de productos.
  //
  // NO se salta el paso 1 a proposito: purchase_type gobierna todos los
  // requisitos posteriores, y selectPurchaseType VACIA el carrito al cruzar
  // la frontera de financiacion. Llegar precargado y que el carrito se
  // vaciara en silencio seria el peor resultado posible.
  // ---------------------------------------------------------------
  const searchParams = useSearchParams()
  const picksApplied = useRef(false)
  const [importedCount, setImportedCount] = useState(0)

  useEffect(() => {
    if (picksApplied.current) return
    if (loadingCatalog || catalogError || products.length === 0) return

    const picks = parseCatalogPicks(searchParams.get(SELECTION_PARAM))
    picksApplied.current = true
    if (picks.length === 0) return

    const byCode = new Map(products.map((p) => [p.code, p]))
    let next: CartLineState[] = []
    let applied = 0
    const trimmed: string[] = []
    for (const pick of picks) {
      const product = byCode.get(pick.code)
      // Los codes desconocidos o inactivos se descartan en silencio: la URL
      // es entrada del usuario y el catalogo puede haber cambiado.
      if (!product) continue
      // El stock puede haber cambiado desde que se eligió en /catalogo: se
      // recorta a lo pedible y se avisa, en vez de traer un carrito que el
      // servidor va a rechazar. Los productos con proveedor no se recortan:
      // lo que falte en almacén se encarga a proveedor (clampToStock).
      let qty = pick.qty
      if (stock) {
        qty = clampToStock(product, pick.qty, toStockLines(next, products), stock)
        if (qty < pick.qty) trimmed.push(product.name)
      }
      if (qty <= 0) continue
      next = applyAddProduct(next, product, qty)
      applied += 1
    }
    if (trimmed.length > 0) {
      setStockNotice(
        `Sin stock suficiente, se ha ajustado: ${trimmed.join(', ')}.`,
      )
    }
    if (applied === 0) return

    setItems(next)
    setImportedCount(applied)
    // replace, nunca push: un refresh no debe volver a aplicar los picks.
    router.replace('/orders/new')
  }, [loadingCatalog, catalogError, products, stock, searchParams, router])

  /**
   * Único punto por el que cambia el carrito del paso 2: tarjetas, botón
   * flotante, líneas, ficha en modal y tablet regalo pasan todos por aquí.
   * Un cambio que suma unidades sin stock no se aplica y se avisa; quitar
   * siempre se puede (guardStockChange).
   */
  function updateItems(next: CartLineState[]) {
    if (stock) {
      const check = guardStockChange(
        toStockLines(items, products),
        toStockLines(next, products),
        stock,
      )
      if (!check.ok) {
        setStockNotice(check.error)
        return
      }
    }
    setStockNotice(null)
    setItems(next)
  }

  /**
   * Lo que, con el stock de ahora, se encargará a proveedor ("Pack Premium
   * ×1"). Es un aviso: el reparto definitivo lo hace el servidor al crear el
   * pedido y lo deja en la nota de cada línea.
   */
  const stockLines = stock ? toStockLines(items, products) : []
  const toSupplier = stock
    ? allocateStock(stockLines, stock).flatMap((a, i) =>
        a.fromSupplier > 0 ? [`${stockLines[i].product.name} ×${a.fromSupplier}`] : [],
      )
    : []

  /** Stock de una tarjeta contando el carrito actual. */
  function stockFor(product: Product) {
    return stock
      ? productStockState(product, toStockLines(items, products), stock)
      : undefined
  }

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Reglas de obligatoriedad segun purchase_type (espejo del server).
  const purchaseTypeOrNull = form.purchase_type === '' ? null : form.purchase_type
  const req = fieldRequirementsFor(purchaseTypeOrNull)
  const isFinancing = form.purchase_type === 'hardware_financiacion'
  // IVA aplicable al plan de financiación: 0 si Canarias, 21 resto.
  const financingVatRate = isCanaryIslands(form.shipping_cp) ? 0 : 21

  /**
   * IVA del preview de las líneas. En cuanto hay un CP de 5 dígitos manda el
   * CP; antes (el paso 2 va antes de pedir la dirección) la única pista es el
   * toggle de región. El servidor recalcula al insertar en cualquier caso.
   *
   * Tiene que ser UNA sola expresión compartida: cuando Step2Catalog/CartFab
   * recibían `region === 'canarias' || isCanaryIslands(cp)` y CartSummary solo
   * `isCanaryIslands(cp)`, un pedido con región canaria y el CP todavía vacío
   * se tarificaba al 0 % en el botón flotante y al 21 % en el resumen de
   * abajo: dos totales distintos en la misma pantalla.
   */
  const previewVatOverride =
    form.shipping_cp.trim().length === 5
      ? isCanaryIslands(form.shipping_cp)
        ? 0
        : null
      : // Sin CP la única pista es la región, y solo vale si hay envío: en
        // transferencias SaaS no se pide dirección, así que la región no
        // puede decidir el impuesto.
        req.shipping && region === 'canarias'
        ? 0
        : null

  // Cambiar el tipo de compra resetea el carrito al cruzar la frontera de
  // financiación (los productos financiables y el resto no son intercambiables).
  function selectPurchaseType(type: PurchaseType) {
    const wasFinancing = form.purchase_type === 'hardware_financiacion'
    const willBeFinancing = type === 'hardware_financiacion'
    const willShip = fieldRequirementsFor(type).shipping
    /*
     * El carrito se vacía al cruzar cualquiera de las dos fronteras: los
     * productos financiables no son intercambiables con el resto, y los de
     * transferencias SaaS (software e implementación, sin envío) tampoco con
     * el hardware. Antes solo se vaciaba en la de financiación, así que al
     * pasar de SaaS a un pedido con envío quedaba Software Qamarero en el
     * carrito, invisible en el catálogo (isCatalogVisible lo oculta fuera de
     * SaaS) pero contando en el total.
     */
    if (wasFinancing !== willBeFinancing || req.shipping !== willShip) {
      setItems([])
    }
    /*
     * Sin envío la región vuelve a península. El toggle de Canarias se oculta
     * en transferencias SaaS, así que una región canaria elegida antes se
     * quedaba puesta e invisible: los resúmenes anunciaban «Exento (Canarias)»
     * y un total un 21 % por debajo del que factura el servidor, que en ese
     * flujo nunca ve un CP.
     */
    if (!willShip) setRegion('peninsula')
    setField('purchase_type', type)
  }

  function goToStep(target: StepNum) {
    setError(null)
    setStep(target)
    setFurthestReached((prev) => (target > prev ? target : prev))
  }

  // ---- Step validations ---------------------------------------------------

  function validateStep1(): string | null {
    if (!form.purchase_type) return 'Selecciona un tipo de compra para continuar.'
    return null
  }

  // Paso 2 del wizard: productos.
  function validateStep2(): string | null {
    const filled = items.filter((it) => it.product_id)
    if (filled.length === 0) {
      return isFinancing
        ? 'Selecciona un producto financiable.'
        : 'Debes añadir al menos un producto al pedido.'
    }
    if (isFinancing) {
      if (filled.length !== 1) {
        return 'Un pedido de financiación debe tener un único producto.'
      }
      const product = products.find((p) => p.id === filled[0].product_id)
      if (!product || !isFinanceableCode(product.code)) {
        return 'El producto seleccionado no es financiable.'
      }
      return stockError()
    }
    for (const it of filled) {
      const product = products.find((p) => p.id === it.product_id)
      if (!product) {
        return 'Hay un producto del carrito que no existe en el catálogo.'
      }
      // Espejo cliente de la validación de POST /api/orders. Los mensajes
      // salen del mismo helper, así que no pueden divergir del servidor.
      if (isFreePrice(product)) {
        if (needsCustomName(product) && !it.product_name_override.trim()) {
          return missingNameError(product)
        }
        if (
          it.unit_price_override_cents === null ||
          it.unit_price_override_cents <= 0
        ) {
          return missingPriceError(product)
        }
      }
    }
    return stockError()
  }

  /**
   * Espejo cliente de la comprobación de stock de POST /api/orders. El stock
   * puede haber bajado mientras se editaba: mejor saberlo aquí que al
   * confirmar.
   */
  function stockError(): string | null {
    if (!stock) return null
    const check = validateStock(toStockLines(items, products), stock)
    return check.ok ? null : check.error
  }

  // Paso 3 del wizard: datos del solicitante + cliente + envío.
  function validateStep3(): string | null {
    if (req.requester_name && !form.requester_name.trim()) {
      return 'El nombre del solicitante es obligatorio.'
    }
    if (req.requester_email && !form.requester_email.trim()) {
      return 'El email del solicitante es obligatorio.'
    }
    if (req.customer_name && !form.customer_name.trim()) {
      return 'El nombre del cliente es obligatorio.'
    }
    if (req.contact_email && !form.contact_email.trim()) {
      return 'El email del cliente es obligatorio.'
    }
    if (req.phone && !form.phone.trim()) {
      return 'El teléfono del cliente es obligatorio.'
    }
    if (req.hubspot_ref && !form.hubspot_ref.trim()) {
      return 'La referencia de HubSpot es obligatoria.'
    }
    if (req.bank_receipt_url && !form.bank_receipt_url.trim()) {
      return 'El justificante bancario es obligatorio.'
    }
    if (req.shipping) {
      if (!form.shipping_street.trim()) return 'La dirección (calle) es obligatoria.'
      if (!form.shipping_cp.trim()) return 'El código postal es obligatorio.'
      if (!/^\d{5}$/.test(form.shipping_cp.trim())) {
        return 'El código postal debe tener 5 dígitos exactos.'
      }
      if (!form.shipping_city.trim()) return 'La ciudad es obligatoria.'
    }
    return null
  }

  // ---- Step navigation ----------------------------------------------------

  function nextStep() {
    setError(null)
    if (step === 1) {
      const err = validateStep1()
      if (err) { setError(err); return }
      goToStep(2)
      return
    }
    if (step === 2) {
      const err = validateStep2()
      if (err) { setError(err); return }
      goToStep(3)
      return
    }
  }

  function prevStep() {
    setError(null)
    if (step === 3) goToStep(2)
    else if (step === 2) goToStep(1)
  }

  // ---- Submit -------------------------------------------------------------

  // Se ejecuta al pulsar "Crear pedido" en el paso 3: valida todo y, si
  // pasa, abre el popup de revisión final. El POST real lo dispara el
  // botón "Confirmar" del propio popup (confirmSubmit).
  function openReview() {
    setError(null)
    const err = validateStep1() ?? validateStep2() ?? validateStep3()
    if (err) {
      setError(err)
      return
    }
    setShowReview(true)
  }

  async function confirmSubmit() {
    setError(null)

    const err = validateStep1() ?? validateStep2() ?? validateStep3()
    if (err) { setError(err); return }

    const filledItems = items.filter((it) => it.product_id)

    setSaving(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_name: form.requester_name.trim() || null,
          requester_email: form.requester_email.trim() || null,
          customer_name: form.customer_name.trim(),
          venue_name: form.venue_name.trim() || null,
          contact_email: form.contact_email.trim() || null,
          phone: form.phone.trim() || null,
          purchase_type: form.purchase_type || null,
          hubspot_ref: form.hubspot_ref.trim() || null,
          bank_receipt_url: form.bank_receipt_url.trim() || null,
          shipping_street: form.shipping_street.trim(),
          shipping_cp: form.shipping_cp.trim(),
          shipping_city: form.shipping_city.trim(),
          shipping_province: form.shipping_province.trim() || null,
          notes: form.notes.trim() || null,
          // Descuento global % sobre la base imponible del pedido (adicional
          // a los descuentos por línea). Se ignora en financiación en el
          // servidor.
          discount_global_pct: discountGlobalPct,
          items: filledItems.map((it) => ({
            product_id: it.product_id,
            qty: it.qty,
            discount_pct: it.discount_pct,
            product_name_override: it.product_name_override.trim() || null,
            unit_price_override_cents: it.unit_price_override_cents,
            // Traza de la línea (hoy solo la de tablet regalo). Sin esto la
            // ficha del pedido enseñaba "—" en la columna de notas y una
            // tablet a 0 € era indistinguible de un descuento equivocado.
            notes: it.notes,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Error al crear el pedido.')
        setSaving(false)
        return
      }
      router.push(`/orders/${data.id}`)
    } catch {
      setError('Error de conexión al crear el pedido.')
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1'
  const sectionClass = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'

  return (
    <div className="px-6 py-8">
      <div className="mb-6">
        <nav className="mb-2 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/orders" className="hover:text-gray-700">Pedidos</Link>
          <span>/</span>
          <span className="text-gray-900">Nuevo pedido</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Crear pedido manual</h1>
      </div>

      {/* El paso 2 es una rejilla de productos y agradece el ancho; los pasos
          1 y 3 son formularios, donde una linea de 1600px se lee peor. */}
      <div
        className={`mx-auto ${step === 2 ? 'max-w-[1600px]' : 'max-w-5xl'}`}
      >
        <div className="mb-6">
          <WizardSteps
            current={step}
            furthestReached={furthestReached}
            onJump={goToStep}
          />
        </div>

        <form
          onSubmit={(e) => {
            // Interceptamos el submit del <form>: en el paso 3 el botón
            // "Crear pedido" abre el popup de revisión (openReview); el
            // POST real solo se dispara desde confirmSubmit al confirmar.
            e.preventDefault()
            if (step === 3) openReview()
          }}
          className="space-y-6"
        >
          {/* =================================================================
              STEP 1: Tipo de compra
              ================================================================= */}
          {step === 1 && (
            <div className={sectionClass}>
              <h2 className="text-sm font-semibold text-gray-900">
                ¿Qué tipo de pedido estás creando?
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                El tipo condiciona qué información se solicita después.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PURCHASE_TYPE_ORDER.map((type) => (
                  <PurchaseTypeTile
                    key={type}
                    type={type}
                    selected={form.purchase_type === type}
                    onSelect={() => selectPurchaseType(type)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* =================================================================
              STEP 3: Datos del solicitante + cliente + envío condicional
              ================================================================= */}
          {step === 3 && (
            <>
              {/* Solicitante */}
              <div className={sectionClass}>
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Solicitante</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>
                      Nombre del solicitante <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.requester_name}
                      onChange={(e) => setField('requester_name', e.target.value)}
                      placeholder="Nombre de quien solicita el pedido"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Email del solicitante <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.requester_email}
                      onChange={(e) => setField('requester_email', e.target.value)}
                      placeholder="Para notificaciones si hay incidencias"
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Cliente */}
              <div className={sectionClass}>
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Datos del cliente</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelClass}>
                      Nombre del cliente <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.customer_name}
                      onChange={(e) => setField('customer_name', e.target.value)}
                      placeholder="Nombre completo o empresa"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Nombre del venue / local</label>
                    <input
                      type="text"
                      value={form.venue_name}
                      onChange={(e) => setField('venue_name', e.target.value)}
                      placeholder="Bar Ejemplo, S.L."
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Email del cliente <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setField('contact_email', e.target.value)}
                      placeholder="contacto@empresa.com"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Teléfono
                      {req.phone && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      placeholder="+34 600 000 000"
                      required={req.phone}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Refs + Justificante */}
              <div className={sectionClass}>
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Referencias y justificante</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>
                      Ref. HubSpot <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.hubspot_ref}
                      onChange={(e) => setField('hubspot_ref', e.target.value)}
                      placeholder="HS-XXXXX"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>
                      Justificante bancario <span className="text-red-500">*</span>
                    </label>
                    <BankReceiptInput
                      value={form.bank_receipt_url}
                      onChange={(v) => setField('bank_receipt_url', v)}
                      className={inputClass}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Direccion de envio (condicional) */}
              {req.shipping ? (
                <div className={sectionClass}>
                  <h2 className="mb-4 text-sm font-semibold text-gray-900">Dirección de envío</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>
                        Dirección (calle, número, piso) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.shipping_street}
                        onChange={(e) => setField('shipping_street', e.target.value)}
                        placeholder="Ej: Gran Vía 1, 3ºB"
                        maxLength={200}
                        required
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>
                        Código postal <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{5}"
                        value={form.shipping_cp}
                        onChange={(e) =>
                          setField('shipping_cp', e.target.value.replace(/\D/g, '').slice(0, 5))
                        }
                        placeholder="28001"
                        maxLength={5}
                        required
                        className={inputClass}
                      />
                      {form.shipping_cp.length > 0 && form.shipping_cp.length !== 5 && (
                        <p className="mt-1 text-xs text-red-600">Debe tener 5 dígitos.</p>
                      )}
                    </div>
                    <div>
                      <label className={labelClass}>
                        Ciudad <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.shipping_city}
                        onChange={(e) => setField('shipping_city', e.target.value)}
                        placeholder="Madrid"
                        maxLength={100}
                        required
                        className={inputClass}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Provincia</label>
                      <input
                        type="text"
                        value={form.shipping_province}
                        onChange={(e) => setField('shipping_province', e.target.value)}
                        placeholder="Ej: Sevilla, Madrid, A Coruña (opcional)"
                        maxLength={50}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-blue-50 px-5 py-4 text-sm text-blue-800 ring-1 ring-blue-200">
                  <strong className="font-semibold">Transferencias SaaS</strong>: no requieren
                  dirección de envío. Si cambias el tipo de compra en el paso anterior, los
                  campos de dirección reaparecerán automáticamente.
                </div>
              )}

              {/* Notas */}
              <div className={sectionClass}>
                <label className={labelClass}>Notas internas</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Información adicional relevante..."
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Recordatorio de qué se está comprando.
                  El paso 3 pedía los datos de envío sin enseñar los productos
                  ni el total, así que el AE rellenaba la dirección a ciegas y
                  no descubría un error del carrito hasta el popup de revisión.
                  Aquí el CP ya se conoce, así que el IVA que se muestra es el
                  definitivo. Solo lectura: el descuento global se toca en el
                  paso 2. */}
              {!loadingCatalog && !catalogError && items.length > 0 && (
                isFinancing ? (
                  <FinancingSummary
                    lines={items}
                    products={products}
                    vatRate={financingVatRate}
                  />
                ) : (
                  <CartSummary
                    lines={items}
                    products={products}
                    vatRateOverride={previewVatOverride}
                    discountGlobalPct={discountGlobalPct}
                  />
                )
              )}
            </>
          )}

          {/* =================================================================
              STEP 2: Productos + resumen
              ================================================================= */}
          {step === 2 && (
            <>
              <StockNotice
                message={stockNotice}
                onClose={() => setStockNotice(null)}
              />
              <div className={sectionClass}>
                {importedCount > 0 && (
                  <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2.5 text-xs text-blue-800 ring-1 ring-blue-200">
                    {importedCount}{' '}
                    {importedCount === 1 ? 'producto' : 'productos'} traídos del
                    catálogo. Revisa la selección antes de continuar.
                  </div>
                )}
                {toSupplier.length > 0 && (
                  <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2.5 text-xs text-blue-800 ring-1 ring-blue-200">
                    <strong className="font-semibold">
                      Se pedirá a proveedor:
                    </strong>{' '}
                    {toSupplier.join(' · ')}. Quien prepare el pedido lo verá en
                    la nota de cada línea.
                  </div>
                )}
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-gray-900">
                    {isFinancing ? 'Producto a financiar' : 'Productos'}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {isFinancing
                      ? 'Solo Pack Pro, Pack Premium y KDS Estándar admiten financiación. Selecciona uno.'
                      : 'Selecciona productos del catálogo Qamarero 2026 o añade una línea libre.'}
                  </p>
                </div>

                {loadingCatalog && (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                    Cargando catálogo de productos…
                  </div>
                )}

                {catalogError && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                    {catalogError}
                  </div>
                )}

                {!loadingCatalog && !catalogError && (
                  isFinancing ? (
                    <FinancingCatalog
                      products={products}
                      items={items}
                      onItemsChange={updateItems}
                      vatRate={financingVatRate}
                      stock={stock}
                    />
                  ) : (
                    <Step2Catalog
                      products={products}
                      items={items}
                      onItemsChange={updateItems}
                      stockFor={stockFor}
                      vatRateOverride={previewVatOverride}
                      purchaseType={form.purchase_type}
                      discountGlobalPct={discountGlobalPct}
                      region={region}
                      onRegionChange={(next) => {
                        // Cambiar de region vacia el carrito: los SKU
                        // peninsulares y canarios son listas de precios
                        // distintas y no son intercambiables.
                        setRegion(next)
                        setItems([])
                        // Prerrellena / limpia el CP del paso 3 para que el
                        // servidor calcule el IVA correcto.
                        if (next === 'canarias' && !isCanaryIslands(form.shipping_cp)) {
                          setField('shipping_cp', '')
                        }
                      }}
                    />
                  )
                )}
              </div>

              {!loadingCatalog && !catalogError && (
                isFinancing ? (
                  <FinancingSummary
                    lines={items}
                    products={products}
                    vatRate={financingVatRate}
                  />
                ) : (
                  <CartSummary
                    lines={items}
                    products={products}
                    vatRateOverride={previewVatOverride}
                    discountGlobalPct={discountGlobalPct}
                    onDiscountGlobalChange={setDiscountGlobalPct}
                  />
                )
              )}
            </>
          )}

          {/* Error global */}
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          {/* =================================================================
              Botones de navegacion
              ================================================================= */}
          {/* En el paso 2 hay que dejar hueco bajo los botones: el boton
              flotante del pedido es `fixed bottom-6 right-6`, asi que al llegar
              al final del scroll se plantaria encima de "Continuar". El FAB
              ocupa hasta ~86px desde el borde inferior; pb-32 (128px) deja
              margen incluso si los botones se envuelven en pantalla estrecha. */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 ${
              step === 2 ? 'pb-32' : 'pb-8'
            }`}
          >
            <div>
              {step > 1 && (
                <button
                  type="button"
                  onClick={prevStep}
                  disabled={saving}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  ← Atrás
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/orders"
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
              >
                Cancelar
              </Link>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  Continuar →
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving || loadingCatalog || !!catalogError}
                  className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Revisar y crear pedido
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Popup de revisión final antes de crear el pedido. */}
      {showReview && (
        <OrderReviewModal
          form={form}
          items={items}
          products={products}
          discountGlobalPct={discountGlobalPct}
          requiresShipping={req.shipping}
          saving={saving}
          error={error}
          onCancel={() => {
            if (!saving) setShowReview(false)
          }}
          onConfirm={confirmSubmit}
        />
      )}
    </div>
  )
}
