'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Search } from 'lucide-react'
import type { Product } from '@/types/database'
import { formatEurosCents } from '@/lib/pricing'
import { MAX_UNIT_PRICE_CENTS } from '@/lib/orders-validation'
import {
  allowsLineDiscount,
  customNameLabel,
  customNamePlaceholder,
  freePriceLabel,
  isFreePrice,
  needsCustomName,
  isHiddenFromCatalog,
  referencePriceCents,
} from '@/lib/product-rules'
import ProductThumb from '@/components/catalog/ProductThumb'
import {
  IMPL_PRO_CODE,
  TABLET_GIFT_CODE,
  TABLET_GIFT_NOTE,
  GIFT_DISCOUNT_PCT,
  findByCode,
} from '@/lib/catalog/rules'
import {
  productStockState,
  stockBadge,
  type ProductStockState,
  type StockView,
} from '@/lib/stock/compute'

interface AddOrderItemModalProps {
  orderId: string
  onClose: () => void
}

type Tab = 'catalog' | 'free'

/**
 * Modal para añadir una línea (order_item) a un pedido existente.
 * Dos pestañas:
 *   - Catálogo: combobox con typeahead para elegir un producto del
 *     catálogo. Snapshot de precio + IVA lo resuelve el server.
 *   - Línea libre: descripción + precio override (mapea al SKU 'otro').
 *
 * Patrón visual: CreateShipmentModal (overlay, Escape close, loading,
 * error inline). Estilo Qamarero (rounded-xl, bg-brand en botón
 * primario, Space Mono en datos numéricos).
 */
export default function AddOrderItemModal({
  orderId,
  onClose,
}: AddOrderItemModalProps) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('catalog')
  const [products, setProducts] = useState<Product[]>([])
  // Stock del usuario (lib/stock): pinta y limita la lista. El servidor
  // vuelve a comprobarlo al añadir la línea.
  const [stock, setStock] = useState<StockView | null>(null)
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState<string | null>(null)

  // Catálogo
  const [productQuery, setProductQuery] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [catalogQty, setCatalogQty] = useState(1)
  const [discountPct, setDiscountPct] = useState<number>(0)
  // Override de nombre/precio para productos especiales ('otro', saas_hardware)
  const [catalogNameOverride, setCatalogNameOverride] = useState('')
  const [catalogPriceOverride, setCatalogPriceOverride] = useState('')

  // Línea libre
  const [freeName, setFreeName] = useState('')
  const [freeQty, setFreeQty] = useState(1)
  const [freePrice, setFreePrice] = useState('')

  // Común
  const [notes, setNotes] = useState('')

  // Toggle: si el producto es Implementación Pro, ofrecemos añadir la
  // tablet KDS Lenovo con 100 % de descuento (regalo).
  const [addTabletGift, setAddTabletGift] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carga el catálogo al montar.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/products', { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json()) as {
          products?: Product[]
          stock?: StockView
        }
        if (!cancelled) {
          setProducts(data.products ?? [])
          setStock(data.stock ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setProductsError(
            err instanceof Error ? err.message : 'Error cargando productos',
          )
        }
      } finally {
        if (!cancelled) setProductsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Escape cierra el modal si no está cargando.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [loading, onClose])

  // Producto seleccionado (lookup en el array).
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  )

  // Reglas del producto seleccionado (precio y descripción libres). Viven en
  // products.pricing_mode, no en una lista de `code`.
  const requiresOverride = isFreePrice(selectedProduct)
  const requiresOverrideName = needsCustomName(selectedProduct)
  // ¿Es Implementación Pro? Activa el toggle "¿lleva tablet?".
  const isImplPro = selectedProduct?.code === IMPL_PRO_CODE
  // Producto tablet regalo (buscado en el catálogo cargado).
  const tabletProduct = useMemo(
    () => findByCode(products, TABLET_GIFT_CODE),
    [products],
  )

  // Una línea nueva por vez: el stock de cada producto se mide sin carrito.
  // Las líneas que el pedido ya tiene cuentan como comprometidas si está
  // abierto, así que ya están descontadas.
  const stockOf = useCallback(
    (p: Product): ProductStockState | undefined =>
      stock ? productStockState(p, [], stock) : undefined,
    [stock],
  )
  const tabletOutOfStock =
    tabletProduct !== null && (stockOf(tabletProduct)?.maxQty ?? Infinity) <= 0

  // Productos filtrados por la búsqueda (case insensitive sobre name).
  // Excluimos los SKU ocultos del catálogo ('otro'): para línea libre se usa
  // el tab "Línea libre"; aquí queremos productos reales.
  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    const base = products.filter((p) => !isHiddenFromCatalog(p))
    if (!q) return base
    return base.filter((p) => p.name.toLowerCase().includes(q))
  }, [products, productQuery])

  // Reset del state al cambiar de tab (limpia errores).
  const switchTab = (next: Tab) => {
    setTab(next)
    setError(null)
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)
      try {
        let body: Record<string, unknown>
        if (tab === 'catalog') {
          if (!selectedProductId) {
            setError('Selecciona un producto del catálogo.')
            setLoading(false)
            return
          }
          if (catalogQty < 1) {
            setError('La cantidad debe ser ≥ 1.')
            setLoading(false)
            return
          }
          body = {
            source: 'catalog',
            product_id: selectedProductId,
            qty: catalogQty,
            discount_pct: discountPct,
            notes: notes.trim() || undefined,
          }
          if (requiresOverride) {
            const overridePrice = Math.round(parseFloat(catalogPriceOverride) * 100)
            if (requiresOverrideName && !catalogNameOverride.trim()) {
              setError('La descripción es obligatoria para este producto.')
              setLoading(false)
              return
            }
            if (!Number.isFinite(overridePrice) || overridePrice <= 0) {
              setError('El precio debe ser mayor que 0.')
              setLoading(false)
              return
            }
            if (catalogNameOverride.trim()) {
              body.product_name = catalogNameOverride.trim()
            }
            body.unit_price_override_cents = overridePrice
          }
        } else {
          // tab === 'free'
          if (!freeName.trim()) {
            setError('La descripción del producto es obligatoria.')
            setLoading(false)
            return
          }
          if (freeQty < 1) {
            setError('La cantidad debe ser ≥ 1.')
            setLoading(false)
            return
          }
          const priceCents = Math.round(parseFloat(freePrice) * 100)
          if (!Number.isFinite(priceCents) || priceCents <= 0) {
            setError('El precio s/IVA debe ser mayor que 0.')
            setLoading(false)
            return
          }
          body = {
            source: 'free',
            product_name: freeName.trim(),
            qty: freeQty,
            unit_price_override_cents: priceCents,
            notes: notes.trim() || undefined,
          }
        }

        const res = await fetch(`/api/orders/${orderId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Error al añadir el artículo.')
          return
        }
        // Si es Implementación Pro y el AE ha marcado el toggle, encadenamos
        // un segundo POST con la tablet Lenovo a 100 % de descuento (regalo).
        if (
          tab === 'catalog' &&
          isImplPro &&
          addTabletGift &&
          !tabletOutOfStock &&
          tabletProduct
        ) {
          const giftRes = await fetch(`/api/orders/${orderId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: 'catalog',
              product_id: tabletProduct.id,
              qty: 1,
              discount_pct: GIFT_DISCOUNT_PCT,
              notes: TABLET_GIFT_NOTE,
            }),
          })
          if (!giftRes.ok) {
            const giftData = await giftRes.json().catch(() => ({}))
            setError(
              giftData.error ??
                'La línea principal se añadió, pero falló añadir la tablet regalo.',
            )
            router.refresh()
            return
          }
        }
        router.refresh()
        onClose()
      } catch {
        setError('Error de conexión. Inténtalo de nuevo.')
      } finally {
        setLoading(false)
      }
    },
    [
      tab,
      selectedProductId,
      catalogQty,
      discountPct,
      requiresOverride,
      catalogNameOverride,
      catalogPriceOverride,
      freeName,
      freeQty,
      freePrice,
      notes,
      orderId,
      onClose,
      router,
      isImplPro,
      addTabletGift,
      tabletOutOfStock,
      tabletProduct,
    ],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Añadir artículo
          </h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            type="button"
            onClick={() => switchTab('catalog')}
            disabled={loading}
            className={`flex-1 px-5 py-3 text-sm font-medium transition-colors ${
              tab === 'catalog'
                ? 'border-b-2 border-brand text-brand'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            Catálogo
          </button>
          <button
            type="button"
            onClick={() => switchTab('free')}
            disabled={loading}
            className={`flex-1 px-5 py-3 text-sm font-medium transition-colors ${
              tab === 'free'
                ? 'border-b-2 border-brand text-brand'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            Línea libre
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {tab === 'catalog' ? (
            <CatalogTab
              productsLoading={productsLoading}
              productsError={productsError}
              filteredProducts={filteredProducts}
              productQuery={productQuery}
              onProductQueryChange={setProductQuery}
              selectedProduct={selectedProduct}
              onSelect={(id) => {
                setSelectedProductId(id)
                const next = products.find((p) => p.id === id) ?? null
                // Los servicios con tarifa (Implementación Pro, 500 €) entran
                // con el importe ya puesto, igual que en el paso 2 del wizard.
                const ref = referencePriceCents(next)
                setCatalogPriceOverride(ref === null ? '' : (ref / 100).toString())
                /*
                 * La descripción SIEMPRE se limpia al cambiar de producto.
                 * Es obligatorio, no cosmético: el campo solo se pinta en los
                 * SKU `free_price_named`, así que si venías de SaaS + Hardware
                 * con texto escrito y pasabas a Implementación Pro, el input
                 * desaparecía de la pantalla pero el texto seguía en el estado
                 * y se enviaba igual como `product_name` — la línea del pedido
                 * quedaba con el nombre del producto equivocado, sin que el AE
                 * pudiera verlo ni corregirlo, y de ahí viajaba a la ficha, al
                 * aviso de Slack y al albarán.
                 */
                setCatalogNameOverride('')
              }}
              qty={catalogQty}
              onQtyChange={setCatalogQty}
              discountPct={discountPct}
              onDiscountChange={setDiscountPct}
              requiresOverride={requiresOverride}
              requiresOverrideName={requiresOverrideName}
              nameOverride={catalogNameOverride}
              onNameOverrideChange={setCatalogNameOverride}
              priceOverride={catalogPriceOverride}
              onPriceOverrideChange={setCatalogPriceOverride}
              stockOf={stockOf}
            />
          ) : (
            <FreeTab
              name={freeName}
              onNameChange={setFreeName}
              qty={freeQty}
              onQtyChange={setFreeQty}
              price={freePrice}
              onPriceChange={setFreePrice}
            />
          )}

          {/* Toggle: regalo tablet KDS Lenovo (solo si el producto elegido
              es Implementación Pro y la tablet existe en el catálogo). */}
          {tab === 'catalog' && isImplPro && tabletProduct && (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                addTabletGift
                  ? 'border-brand/40 bg-brand/5'
                  : 'border-dashed border-brand/30 bg-brand/5 hover:bg-brand/10'
              }`}
            >
              <input
                type="checkbox"
                checked={addTabletGift && !tabletOutOfStock}
                disabled={tabletOutOfStock}
                onChange={(e) => setAddTabletGift(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <span aria-hidden="true">🎁</span>
                  Incluir Tablet Lenovo Tab Plus como regalo
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  Añade una línea de tablet con 100 % de descuento (valor{' '}
                  <span className="font-mono">
                    {formatEurosCents(tabletProduct.price_cents)}
                  </span>
                  ). Solo si el paquete acordado la incluye.
                  {tabletOutOfStock && (
                    <strong className="ml-1 font-semibold text-red-700">
                      Ahora mismo no queda stock de tablets.
                    </strong>
                  )}
                </p>
              </div>
            </label>
          )}

          {/* Notas (común a las 2 tabs) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Notas (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales para esta línea"
              disabled={loading}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || productsLoading}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Añadiendo…' : 'Añadir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===================================================================
// Tab Catálogo
// ===================================================================

interface CatalogTabProps {
  productsLoading: boolean
  productsError: string | null
  filteredProducts: Product[]
  productQuery: string
  onProductQueryChange: (q: string) => void
  selectedProduct: Product | null
  onSelect: (id: string | null) => void
  qty: number
  onQtyChange: (n: number) => void
  discountPct: number
  onDiscountChange: (n: number) => void
  requiresOverride: boolean
  /** Solo `free_price_named` pide además descripción. */
  requiresOverrideName: boolean
  nameOverride: string
  onNameOverrideChange: (s: string) => void
  priceOverride: string
  onPriceOverrideChange: (s: string) => void
  /** Stock de cada producto (lib/stock); undefined = sin datos, sin tope. */
  stockOf: (p: Product) => ProductStockState | undefined
}

function CatalogTab({
  productsLoading,
  productsError,
  filteredProducts,
  productQuery,
  onProductQueryChange,
  selectedProduct,
  onSelect,
  qty,
  onQtyChange,
  discountPct,
  onDiscountChange,
  requiresOverride,
  requiresOverrideName,
  nameOverride,
  onNameOverrideChange,
  priceOverride,
  onPriceOverrideChange,
  stockOf,
}: CatalogTabProps) {
  // Las ofertas de precio cerrado fuerzan descuento 0 (el precio negociado ES
  // el final). Lo dice products.allows_discount, no una lista de `code`.
  const isSaasHw = !allowsLineDiscount(selectedProduct)
  const selectedStock = selectedProduct ? stockOf(selectedProduct) : undefined
  const maxQty =
    selectedStock && Number.isFinite(selectedStock.maxQty)
      ? selectedStock.maxQty
      : undefined

  return (
    <>
      {/* Combobox de producto */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Producto
        </label>
        {productsLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando catálogo…
          </div>
        ) : productsError ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Error: {productsError}
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={productQuery}
                onChange={(e) => onProductQueryChange(e.target.value)}
                placeholder="Buscar por nombre…"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-200">
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-gray-400">
                  Sin resultados.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filteredProducts.map((p) => {
                    const active = selectedProduct?.id === p.id
                    const s = stockOf(p)
                    const badge = s ? stockBadge(s) : null
                    // Sin stock: se ve (para saber que existe) pero no se elige.
                    const blocked = s !== undefined && s.maxQty <= 0
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(p.id)}
                          disabled={blocked}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            active
                              ? 'bg-brand/5 text-gray-900'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {/* Miniatura: esta lista no tenía imágenes, que era
                              justo la queja de fondo de esta superficie. */}
                          <ProductThumb product={p} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{p.name}</span>
                            {p.brand && (
                              <span className="block truncate text-[11px] text-gray-500">
                                {[p.brand, p.model].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {badge && (
                              <span
                                className={`block text-[11px] font-semibold ${
                                  s?.supplier && (s.unknown || s.available <= 0)
                                    ? 'text-blue-700'
                                    : s && (s.unknown || s.available <= 0)
                                      ? 'text-red-600'
                                      : 'text-amber-700'
                                }`}
                              >
                                {badge}
                                {s?.supplier && (s.unknown || s.available <= 0)
                                  ? ' · sin stock, se encarga'
                                  : s?.bypass && (s.unknown || s.available <= 0)
                                    ? ' · puedes pedirlo como admin'
                                    : ''}
                              </span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-xs tabular-nums ${
                              active ? 'text-brand' : 'text-gray-500'
                            }`}
                          >
                            {isFreePrice(p)
                              ? 'A convenir'
                              : formatEurosCents(p.price_cents)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* Overrides de los productos con precio acordado.
          La descripción SOLO en `free_price_named` (otro / SaaS + Hardware):
          antes se pintaba para todo `isFreePrice`, así que Implementación Pro y
          Software Qamarero mostraban un campo marcado como obligatorio con
          asterisco rojo que el submit no exigía. Las etiquetas salen de
          lib/product-rules para no divergir de CartLine. */}
      {requiresOverride && (
        <>
          {requiresOverrideName && selectedProduct && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {customNameLabel(selectedProduct)}
                <span className="ml-1 text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nameOverride}
                onChange={(e) => onNameOverrideChange(e.target.value)}
                placeholder={customNamePlaceholder(selectedProduct)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {selectedProduct
                ? freePriceLabel(selectedProduct)
                : 'Precio negociado s/IVA (€)'}
              <span className="ml-1 text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min={0.01}
              max={MAX_UNIT_PRICE_CENTS / 100}
              value={priceOverride}
              onChange={(e) => onPriceOverrideChange(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-right font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </>
      )}

      {/* Cantidad + descuento */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Cantidad
            {maxQty !== undefined && (
              <span className="ml-1 font-normal text-gray-500">
                (máx. {maxQty})
              </span>
            )}
          </label>
          <input
            type="number"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) => {
              const n = Math.max(1, parseInt(e.target.value) || 1)
              onQtyChange(
                maxQty !== undefined ? Math.min(n, Math.max(1, maxQty)) : n,
              )
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-right font-mono text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Descuento (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={discountPct}
            onChange={(e) => {
              if (isSaasHw) return
              const raw = parseInt(e.target.value, 10)
              const clamped = Number.isFinite(raw)
                ? Math.max(0, Math.min(100, raw))
                : 0
              onDiscountChange(clamped)
            }}
            disabled={isSaasHw}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-center font-mono text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            title={
              isSaasHw
                ? 'SaaS + Hardware no admite descuento (precio negociado es el final).'
                : 'Descuento por línea: entero entre 0 y 100'
            }
          />
          {/* Presets rápidos para agilizar */}
          {!isSaasHw && (
            <div className="mt-1 flex gap-1">
              {[10, 20, 50, 100].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onDiscountChange(preset)}
                  className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50"
                >
                  {preset}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ===================================================================
// Tab Línea libre
// ===================================================================

interface FreeTabProps {
  name: string
  onNameChange: (s: string) => void
  qty: number
  onQtyChange: (n: number) => void
  price: string
  onPriceChange: (s: string) => void
}

function FreeTab({
  name,
  onNameChange,
  qty,
  onQtyChange,
  price,
  onPriceChange,
}: FreeTabProps) {
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Descripción del producto
          <span className="ml-1 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ej. Cable HDMI 2m"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Cantidad
          </label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) =>
              onQtyChange(Math.max(1, parseInt(e.target.value) || 1))
            }
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-right font-mono text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Precio s/IVA (€)
            <span className="ml-1 text-red-500">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min={0.01}
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-right font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>
      <p className="text-[10px] text-gray-400">
        Las líneas libres se guardan internamente como artículos &quot;otro&quot;
        sin enlace al catálogo. El IVA se aplica según el CP de envío.
      </p>
    </>
  )
}
