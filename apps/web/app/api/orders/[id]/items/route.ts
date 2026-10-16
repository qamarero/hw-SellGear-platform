// =============================================================
// /api/orders/[id]/items
//
// GET:  lista order_items de un pedido (lazy-load del popup
//       "Detalle de envío" en OrdersTable; la lista principal ya no
//       trae order_items para evitar statement timeout).
//
// POST: añade una línea (order_item) a un pedido existente. Sustituye
//       al insert directo desde el cliente que tenía ItemsList.tsx,
//       ahora con validaciones server-side idénticas a las del POST
//       /api/orders. Acepta dos sources:
//         - 'catalog': product_id de la tabla products. Snapshot de
//           precio y vat_rate (override Canarias si CP 35xxx/38xxx).
//           Soporta productos especiales 'otro' y saas_hardware con
//           overrides.
//         - 'free': atajo para línea libre. Mapea internamente al SKU
//           especial 'otro' con product_name_override + precio
//           override.
//
// Permisos:
//   GET:  cualquier usuario autenticado (RLS filtra).
//   POST: canEditOrder (admin/manager/hardware). Viewer/commercial
//         no pueden editar items.
// =============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditOrder } from '@/lib/auth'
import {
  MAX_LINE_QTY,
  validateLineDiscount,
  validateUnitPriceCents,
} from '@/lib/orders-validation'
import { isCanaryIslands } from '@/lib/utils'
import type { UserRole, Product } from '@/types/database'
import {
  isFreePrice,
  needsCustomName,
  requiresCanaryShipping,
  missingNameError,
  missingPriceError,
  canaryShippingError,
} from '@/lib/product-rules'
import { allocateStock, supplierNote, validateStock } from '@/lib/stock/compute'
import { canBypassStock, loadStockSnapshot, toStockView } from '@/lib/stock/server'

export const runtime = 'nodejs'

interface RequestBody {
  source?: 'catalog' | 'free'
  product_id?: unknown
  qty?: unknown
  discount_pct?: unknown
  product_name?: unknown
  unit_price_override_cents?: unknown
  notes?: unknown
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params

  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // 2. Autorización: canEditOrder
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = profile?.role as UserRole | undefined
  if (!canEditOrder(role)) {
    return NextResponse.json(
      { error: 'No tienes permisos para editar pedidos.' },
      { status: 403 },
    )
  }

  // 3. Parse body
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const source = body.source
  if (source !== 'catalog' && source !== 'free') {
    return NextResponse.json(
      { error: "source debe ser 'catalog' o 'free'." },
      { status: 400 },
    )
  }

  const qty = typeof body.qty === 'number' ? Math.floor(body.qty) : 0
  // Cota superior por la columna (order_items.qty es INT), no de negocio.
  if (qty < 1 || qty > MAX_LINE_QTY) {
    return NextResponse.json(
      { error: 'La cantidad debe ser un entero mayor o igual a 1.' },
      { status: 400 },
    )
  }

  const notes =
    typeof body.notes === 'string' ? body.notes.trim() || null : null

  const admin = createAdminClient()

  // 4. Cargar el pedido para conocer shipping_cp (decide IVA Canarias).
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, shipping_cp')
    .eq('id', orderId)
    .single()
  if (orderError || !order) {
    return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })
  }

  const isCanaryExempt = isCanaryIslands(order.shipping_cp)
  const overrideVatRate: number | null = isCanaryExempt ? 0 : null

  // 5. Resolver el producto + precio + IVA en función del source.
  let resolvedProductId: string
  let resolvedProductName: string
  let resolvedUnitPriceCents: number
  let resolvedDiscountPct = 0
  let resolvedVatRate: number
  // Unidades que van a proveedor por falta de stock, y su aviso para quien
  // prepara el pedido. Solo productos con supplier_fallback.
  let supplierQty = 0
  let supplierWarning: string | null = null

  if (source === 'catalog') {
    // Catálogo: requiere product_id, valida activo + descuento.
    if (typeof body.product_id !== 'string' || !body.product_id) {
      return NextResponse.json(
        { error: 'product_id es obligatorio cuando source=catalog.' },
        { status: 400 },
      )
    }

    const { data: product, error: productError } = await admin
      .from('products')
      .select('*')
      .eq('id', body.product_id)
      .eq('active', true)
      .single()
    if (productError || !product) {
      return NextResponse.json(
        { error: 'Producto inactivo o inexistente en el catálogo.' },
        { status: 400 },
      )
    }

    // Los SKU canarios llevan precio FINAL con vat_rate = 0: si se colara en
    // un pedido peninsular se facturaría al 0 % con precio canario.
    if (requiresCanaryShipping(product as Product) && !isCanaryExempt) {
      return NextResponse.json(
        { error: canaryShippingError(product as Product) },
        { status: 400 },
      )
    }

    // Stock: la línea nueva tiene que caber en lo pedible. Las líneas que el
    // pedido ya tiene no se vuelven a sumar: si está abierto, ya cuentan
    // como comprometidas. La tablet regalo del modal entra por aquí también.
    const stockView = toStockView(await loadStockSnapshot(), false)
    const stockLine = { product: product as Product, qty }
    if (!canBypassStock(user.email, role)) {
      const stockCheck = validateStock([stockLine], stockView)
      if (!stockCheck.ok) {
        return NextResponse.json({ error: stockCheck.error }, { status: 409 })
      }
    }
    // Reparto almacén / proveedor también para admins (ver POST /api/orders).
    const [allocation] = allocateStock([stockLine], stockView)
    supplierQty = allocation.fromSupplier
    supplierWarning = supplierNote(allocation, qty, product as Product)

    // Rango libre 0-100 entero; allows_discount = false fuerza 0.
    const discountPctRaw =
      typeof body.discount_pct === 'number' ? body.discount_pct : 0
    const discountCheck = validateLineDiscount(discountPctRaw, product as Product)
    if (!discountCheck.ok) {
      return NextResponse.json({ error: discountCheck.error }, { status: 400 })
    }
    resolvedDiscountPct = discountCheck.pct

    // Productos con precio libre negociado (mismo patrón que POST /api/orders).
    if (isFreePrice(product as Product)) {
      const overrideName =
        typeof body.product_name === 'string' ? body.product_name.trim() : ''
      if (needsCustomName(product as Product) && !overrideName) {
        return NextResponse.json(
          { error: missingNameError(product as Product) },
          { status: 400 },
        )
      }
      const overridePrice =
        typeof body.unit_price_override_cents === 'number'
          ? Math.floor(body.unit_price_override_cents)
          : 0
      if (overridePrice <= 0) {
        return NextResponse.json(
          { error: missingPriceError(product as Product) },
          { status: 400 },
        )
      }
      resolvedProductId = (product as Product).id
      // Productos con nombre fijo del catálogo (implementación pro, software
      // qamarero) conservan el nombre si no llega override.
      resolvedProductName = overrideName || (product as Product).name
      resolvedUnitPriceCents = overridePrice
    } else {
      resolvedProductId = (product as Product).id
      resolvedProductName = (product as Product).name
      resolvedUnitPriceCents = (product as Product).price_cents
    }

    resolvedVatRate = overrideVatRate ?? Number((product as Product).vat_rate)
  } else {
    // source === 'free': atajo para línea libre. Internamente lo mapeamos
    // al SKU especial 'otro' del catálogo (ya seedeado) con overrides.
    const overrideName =
      typeof body.product_name === 'string' ? body.product_name.trim() : ''
    if (!overrideName) {
      return NextResponse.json(
        { error: 'La descripción del producto es obligatoria.' },
        { status: 400 },
      )
    }
    const overridePrice =
      typeof body.unit_price_override_cents === 'number'
        ? Math.floor(body.unit_price_override_cents)
        : 0
    if (overridePrice <= 0) {
      return NextResponse.json(
        { error: 'El precio unitario debe ser mayor que 0.' },
        { status: 400 },
      )
    }

    // Buscar el sku 'otro' (debe existir por seed; si no, error claro).
    const { data: otroProduct, error: otroError } = await admin
      .from('products')
      .select('id, vat_rate')
      .eq('code', 'otro')
      .single()
    if (otroError || !otroProduct) {
      return NextResponse.json(
        {
          error:
            'Configuración: producto "otro" no existe en el catálogo. Contacta con un admin.',
        },
        { status: 500 },
      )
    }

    resolvedProductId = otroProduct.id
    resolvedProductName = overrideName
    resolvedUnitPriceCents = overridePrice
    resolvedDiscountPct = 0
    resolvedVatRate = overrideVatRate ?? Number(otroProduct.vat_rate)
  }

  // El importe tiene que caber en order_items.unit_price_cents (INTEGER):
  // si no, el insert revienta con "value out of range for type integer" y el
  // recálculo del total del pedido de más abajo no llega a ejecutarse.
  const priceCheck = validateUnitPriceCents(
    resolvedUnitPriceCents,
    resolvedProductName,
  )
  if (!priceCheck.ok) {
    return NextResponse.json({ error: priceCheck.error }, { status: 400 })
  }

  // 6. Insert
  const { data: inserted, error: insertError } = await admin
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id: resolvedProductId,
      product_name: resolvedProductName,
      qty,
      discount_pct: resolvedDiscountPct,
      unit_price_cents: resolvedUnitPriceCents,
      vat_rate: resolvedVatRate,
      supplier_qty: supplierQty,
      notes: [notes, supplierWarning].filter(Boolean).join(' · ') || null,
    })
    .select('*')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ item: inserted })
}

// =============================================================
// GET /api/orders/[id]/items
// Lista los order_items de un pedido. Se llama on-demand desde el
// popup "Detalle de envío" en OrdersTable, para no traer items en
// el SELECT principal de /orders (causa del statement timeout).
// =============================================================
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // RLS filtra automáticamente según el rol; no necesitamos check extra.
  const { data, error } = await supabase
    .from('order_items')
    .select(
      'id, order_id, product_id, product_name, qty, unit_price, unit_price_cents, discount_pct, vat_rate, notes, created_at',
    )
    .eq('order_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}
