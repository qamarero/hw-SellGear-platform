import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PurchaseType, Product, UserRole } from '@/types/database'
import { cartTotals } from '@/lib/pricing'
import { canCreateOrder } from '@/lib/auth'
import {
  MAX_LINE_QTY,
  validateGlobalDiscount,
  validateLineDiscount,
  validateUnitPriceCents,
} from '@/lib/orders-validation'
import { upsertAddressFromOrder } from '@/lib/address-book/upsert'
import { isCanaryIslands } from '@/lib/utils'
import { isValidPurchaseType } from '@/lib/purchase-type'
import { fieldRequirementsFor } from '@/lib/order-requirements'
import {
  isFreePrice,
  needsCustomName,
  requiresCanaryShipping,
  missingNameError,
  missingPriceError,
  canaryShippingError,
} from '@/lib/product-rules'
import {
  FINANCEABLE_LABEL,
  isFinanceableCode,
  financingBaseTotalCents,
  financingInstallments,
} from '@/lib/financing'
import {
  notifyOrderEvent,
  formatItemsSummary,
  withSupplierWarning,
} from '@/lib/slack'
import {
  allocateStock,
  demandByPool,
  supplierNote,
  validateStock,
  type StockLine,
} from '@/lib/stock/compute'
import { canBypassStock, loadStockSnapshot, toStockView } from '@/lib/stock/server'

/**
 * Tope de `order_items.notes` que acepta este endpoint.
 *
 * La columna es TEXT sin límite y el valor llega del cliente. Hoy el wizard
 * solo manda la constante TABLET_GIFT_NOTE, así que 500 sobra de largo.
 */
const MAX_ITEM_NOTES_LEN = 500

export async function POST(request: NextRequest) {
  // 1. Authenticate via user session
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // 1.b. Authorize: solo commercial/hardware/admin pueden crear pedidos.
  // full_name lo usamos en el footer del aviso de Slack (lib/slack.ts).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()
  const role = profile?.role as UserRole | undefined
  if (!canCreateOrder(role)) {
    return NextResponse.json(
      { error: 'No tienes permisos para crear pedidos.' },
      { status: 403 }
    )
  }

  // 2. Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo de petición inválido' }, { status: 400 })
  }

  // 3. Validar purchase_type primero: condiciona que campos son required.
  //    transferencias_saas no exige envio ni telefono (transferencia bancaria).
  const purchaseType = isValidPurchaseType(body.purchase_type)
    ? body.purchase_type
    : null
  const req = fieldRequirementsFor(purchaseType)

  // 4. Validate required fields (segun fieldRequirementsFor).
  const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : ''
  if (req.customer_name && !customerName) {
    return NextResponse.json(
      { error: 'El nombre del cliente es obligatorio.' },
      { status: 400 }
    )
  }

  // Nombre del solicitante (decision 2026-05-26: obligatorio en todos los tipos).
  const requesterName = typeof body.requester_name === 'string' ? body.requester_name.trim() : ''
  if (req.requester_name && !requesterName) {
    return NextResponse.json(
      { error: 'El nombre del solicitante es obligatorio.' },
      { status: 400 }
    )
  }

  // Email del cliente (decision 2026-05-26: obligatorio en todos los tipos).
  const contactEmail = typeof body.contact_email === 'string' ? body.contact_email.trim() : ''
  if (req.contact_email && !contactEmail) {
    return NextResponse.json(
      { error: 'El email del cliente es obligatorio.' },
      { status: 400 }
    )
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json({ error: 'Email de contacto inválido.' }, { status: 400 })
  }

  // Email del solicitante (decision 2026-05-26: obligatorio en todos los tipos).
  const requesterEmail = typeof body.requester_email === 'string' ? body.requester_email.trim() : ''
  if (req.requester_email && !requesterEmail) {
    return NextResponse.json(
      { error: 'El email del solicitante es obligatorio.' },
      { status: 400 }
    )
  }
  if (requesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
    return NextResponse.json({ error: 'Email del solicitante inválido.' }, { status: 400 })
  }

  // Telefono del cliente obligatorio para pedidos manuales (excepto transferencias_saas).
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (req.phone && !phone) {
    return NextResponse.json(
      { error: 'El teléfono del cliente es obligatorio.' },
      { status: 400 }
    )
  }

  // HubSpot ref (decision 2026-05-26: obligatorio en todos los tipos).
  const hubspotRef = typeof body.hubspot_ref === 'string' ? body.hubspot_ref.trim() : ''
  if (req.hubspot_ref && !hubspotRef) {
    return NextResponse.json(
      { error: 'La referencia de HubSpot es obligatoria.' },
      { status: 400 }
    )
  }

  // Justificante bancario: obligatorio en todos los tipos. Validar URL si llega.
  const bankReceiptUrl = typeof body.bank_receipt_url === 'string' ? body.bank_receipt_url.trim() : ''
  if (req.bank_receipt_url && !bankReceiptUrl) {
    return NextResponse.json(
      { error: 'El justificante bancario es obligatorio.' },
      { status: 400 }
    )
  }
  if (bankReceiptUrl) {
    try {
      new URL(bankReceiptUrl)
    } catch {
      return NextResponse.json({ error: 'URL del justificante bancario inválida.' }, { status: 400 })
    }
  }

  // Direccion estructurada (4 campos). Obligatoria solo si req.shipping (no en transferencias_saas).
  // Provincia siempre opcional.
  const shippingStreet   = typeof body.shipping_street   === 'string' ? body.shipping_street.trim()   : ''
  const shippingCp       = typeof body.shipping_cp       === 'string' ? body.shipping_cp.trim()       : ''
  const shippingCity     = typeof body.shipping_city     === 'string' ? body.shipping_city.trim()     : ''
  const shippingProvince = typeof body.shipping_province === 'string' ? body.shipping_province.trim() : ''

  if (req.shipping) {
    if (!shippingStreet) {
      return NextResponse.json({ error: 'La dirección (calle) es obligatoria.' }, { status: 400 })
    }
    if (!shippingCp) {
      return NextResponse.json({ error: 'El código postal es obligatorio.' }, { status: 400 })
    }
    if (!/^\d{5}$/.test(shippingCp)) {
      return NextResponse.json(
        { error: 'El código postal debe tener 5 dígitos exactos.' },
        { status: 400 }
      )
    }
    if (!shippingCity) {
      return NextResponse.json({ error: 'La ciudad es obligatoria.' }, { status: 400 })
    }
  } else if (shippingCp && !/^\d{5}$/.test(shippingCp)) {
    // Si el cliente envio un CP por error en un tipo sin envio, validamos el formato pero no lo exigimos.
    return NextResponse.json(
      { error: 'El código postal debe tener 5 dígitos exactos.' },
      { status: 400 }
    )
  }

  // Serializar los 4 campos estructurados a shipping_address (compat con vistas legacy).
  // Vacio si no hay datos de envio (transferencias_saas).
  const serializedAddress = req.shipping
    ? [shippingStreet, `${shippingCp} ${shippingCity}`, shippingProvince || null]
        .filter((part) => part && part.trim().length > 0)
        .join(', ')
    : ''

  // 5. Validar y resolver items del carrito ANTES de crear el pedido.
  // El servidor recalcula precios desde products (no se confia en el cliente).
  const admin = createAdminClient()

  const rawItems = Array.isArray(body.items) ? body.items : []
  if (rawItems.length === 0) {
    return NextResponse.json(
      { error: 'Debes añadir al menos un producto al pedido.' },
      { status: 400 },
    )
  }

  interface CartItemInput {
    product_id: string
    qty: number
    discount_pct: number
    product_name_override: string | null
    unit_price_override_cents: number | null
    /**
     * Nota de la línea -> order_items.notes. La usa el wizard para marcar la
     * tablet de regalo por Implementación Pro: en la ficha del pedido es lo
     * único que explica una línea a 0 €, y sin ella quien prepara el envío no
     * sabe que la tablet va incluida. Mismo contrato que
     * POST /api/orders/[id]/items.
     */
    notes: string | null
  }

  const cartInputs: CartItemInput[] = []
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) {
      return NextResponse.json({ error: 'Línea de carrito inválida.' }, { status: 400 })
    }
    const r = raw as Record<string, unknown>
    if (typeof r.product_id !== 'string' || !r.product_id) {
      return NextResponse.json(
        { error: 'Cada línea debe tener product_id.' },
        { status: 400 },
      )
    }
    const qty = typeof r.qty === 'number' ? Math.floor(r.qty) : 0
    // Cota superior por la columna (order_items.qty es INT), no de negocio:
    // sin ella el insert de líneas puede reventar después de crear el pedido.
    if (qty < 1 || qty > MAX_LINE_QTY) {
      return NextResponse.json(
        { error: 'La cantidad debe ser un entero mayor o igual a 1.' },
        { status: 400 },
      )
    }
    // Validacion completa (set + categoria) ocurre mas abajo, cuando tenemos
    // el producto resuelto del catalogo. Aqui solo validamos que sea numero.
    const discountPct = typeof r.discount_pct === 'number' ? r.discount_pct : 0
    if (!Number.isFinite(discountPct)) {
      return NextResponse.json(
        { error: 'Descuento invalido.' },
        { status: 400 },
      )
    }
    cartInputs.push({
      product_id: r.product_id,
      qty,
      discount_pct: discountPct,
      product_name_override:
        typeof r.product_name_override === 'string'
          ? r.product_name_override.trim() || null
          : null,
      unit_price_override_cents:
        typeof r.unit_price_override_cents === 'number'
          ? Math.floor(r.unit_price_override_cents)
          : null,
      // order_items.notes es TEXT sin límite, y esto llega de un cliente: se
      // recorta a 500 para que no se pueda usar como saco de datos.
      notes:
        typeof r.notes === 'string'
          ? r.notes.trim().slice(0, MAX_ITEM_NOTES_LEN) || null
          : null,
    })
  }

  // Financiación: composición fija — 1 único producto financiable, qty 1, sin
  // descuento. La validación del code financiable ocurre abajo (necesita el
  // producto resuelto del catálogo).
  const isFinancing = purchaseType === 'hardware_financiacion'
  if (isFinancing) {
    if (cartInputs.length !== 1) {
      return NextResponse.json(
        { error: 'Un pedido de financiación debe tener exactamente un producto.' },
        { status: 400 },
      )
    }
    if (cartInputs[0].qty !== 1) {
      return NextResponse.json(
        { error: 'En financiación la cantidad debe ser 1.' },
        { status: 400 },
      )
    }
    if (cartInputs[0].discount_pct !== 0) {
      return NextResponse.json(
        { error: 'Los pedidos de financiación no admiten descuento.' },
        { status: 400 },
      )
    }
  }

  // Descuento global (%) opcional. Se aplica sobre la base imponible
  // agregada después de los descuentos por línea (ver cartTotals + doc en
  // pricing.ts). Financiación NO admite descuento global (plan fijo).
  let discountGlobalPct = 0
  if (body.discount_global_pct !== undefined && body.discount_global_pct !== null) {
    const check = validateGlobalDiscount(body.discount_global_pct)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }
    discountGlobalPct = check.pct
  }
  if (isFinancing && discountGlobalPct !== 0) {
    return NextResponse.json(
      { error: 'Los pedidos de financiación no admiten descuento global.' },
      { status: 400 },
    )
  }

  const productIds = Array.from(new Set(cartInputs.map((it) => it.product_id)))
  const { data: catalogProducts, error: productsError } = await admin
    .from('products')
    .select('*')
    .in('id', productIds)
    .eq('active', true)

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 })
  }

  const productMap = new Map<string, Product>()
  for (const p of (catalogProducts ?? []) as Product[]) {
    productMap.set(p.id, p)
  }

  // Resolver cada línea: snapshot de precio, IVA y nombre.
  interface ResolvedLine {
    product_id: string
    product_name: string
    qty: number
    discount_pct: number
    unit_price_cents: number
    vat_rate: number
    notes: string | null
  }
  // Politica fiscal Canarias (actualizada 21-may-2026):
  //   - Por acuerdo comercial de la empresa, las ventas/envios a Canarias
  //     se facturan SIN impuesto (vat_rate = 0). Antes (12-may a 20-may)
  //     se aplicaba IGIC 7%; pedidos creados en ese rango lo mantienen
  //     por snapshot inmutable.
  //   - Sigue gobernado por isCanaryIslands(shipping_cp) -> CP 35xxx/38xxx.
  // Snapshot inmutable en order_items.vat_rate. Solo afecta a pedidos nuevos.
  const isCanaryExempt = isCanaryIslands(shippingCp)
  const overrideVatRate: number | null = isCanaryExempt ? 0 : null

  const resolved: ResolvedLine[] = []
  for (const it of cartInputs) {
    const product = productMap.get(it.product_id)
    if (!product) {
      return NextResponse.json(
        { error: 'Producto inactivo o inexistente en el carrito.' },
        { status: 400 },
      )
    }
    // Rango libre 0-100 entero; los productos con allows_discount = false
    // (oferta cerrada) fuerzan 0. Regla en lib/product-rules.ts.
    const discountCheck = validateLineDiscount(it.discount_pct, product)
    if (!discountCheck.ok) {
      return NextResponse.json({ error: discountCheck.error }, { status: 400 })
    }
    // Los SKU canarios llevan precio FINAL con vat_rate = 0. Si se colara en
    // un pedido peninsular, overrideVatRate sería null y la línea se
    // facturaría al 0 % con precio canario. Hay que rechazarlo aquí: el
    // cliente ya no ofrece la mezcla, pero el servidor no puede confiar.
    if (requiresCanaryShipping(product) && !isCanaryExempt) {
      return NextResponse.json(
        { error: canaryShippingError(product) },
        { status: 400 },
      )
    }
    let unitPriceCents = product.price_cents
    let productName = product.name
    const isFreePriceProduct = isFreePrice(product)
    if (isFinancing) {
      // Financiación: solo 3 productos. El precio = base total del plan
      // (suma de los 3 plazos), que REEMPLAZA al precio de catálogo
      // (financiar es más caro). El IVA se aplica igual (Canarias 0 %).
      if (!isFinanceableCode(product.code)) {
        return NextResponse.json(
          {
            error: `Producto no financiable. Solo ${FINANCEABLE_LABEL} admiten financiación.`,
          },
          { status: 400 },
        )
      }
      unitPriceCents = financingBaseTotalCents(product.code)!
    } else if (isFreePriceProduct) {
      if (needsCustomName(product) && !it.product_name_override) {
        return NextResponse.json(
          { error: missingNameError(product) },
          { status: 400 },
        )
      }
      if (
        it.unit_price_override_cents === null ||
        it.unit_price_override_cents <= 0
      ) {
        return NextResponse.json(
          { error: missingPriceError(product) },
          { status: 400 },
        )
      }
      unitPriceCents = it.unit_price_override_cents
      // Los productos con nombre fijo del catálogo (implementación pro,
      // software qamarero) conservan su nombre si no llega override.
      if (it.product_name_override) {
        productName = it.product_name_override
      }
    }
    // El importe tiene que caber en order_items.unit_price_cents (INTEGER)
    // ANTES de crear nada: si no, `orders` entra —su amount es NUMERIC(12,2) y
    // aguanta mucho más— y el insert de líneas revienta, y ese fallo hoy solo
    // se registra con console.error unas líneas más abajo, así que la API
    // responde 200 con un pedido de cero artículos.
    const priceCheck = validateUnitPriceCents(unitPriceCents, productName)
    if (!priceCheck.ok) {
      return NextResponse.json({ error: priceCheck.error }, { status: 400 })
    }
    resolved.push({
      product_id: product.id,
      product_name: productName,
      qty: it.qty,
      discount_pct: it.discount_pct,
      unit_price_cents: unitPriceCents,
      // Snapshot inmutable: envío a Canarias -> exento (0 %); si no, el IVA
      // del producto (21 % por defecto).
      vat_rate: overrideVatRate ?? Number(product.vat_rate),
      notes: it.notes,
    })
  }

  // 5.c Stock. Un no-admin solo pide lo que hay; un admin pide sin tope
  // (reacondicionados, sustituciones, urgencias) pero su pedido reserva igual.
  // Se comprueba ANTES de crear nada. Ver lib/stock/compute.ts.
  const stockBypass = canBypassStock(user.email, role)
  const stockLines: StockLine[] = resolved.map((l) => ({
    product: productMap.get(l.product_id)!,
    qty: l.qty,
  }))
  const stockView = toStockView(await loadStockSnapshot(), false)
  if (!stockBypass) {
    const stockCheck = validateStock(stockLines, stockView)
    if (!stockCheck.ok) {
      return NextResponse.json({ error: stockCheck.error }, { status: 409 })
    }
  }
  // Reparto almacén / proveedor, para TODOS (también admins): quien prepara
  // el pedido tiene que saber qué se encarga a proveedor lo pida quien lo
  // pida. Mismo orden que `resolved`.
  const allocation = allocateStock(stockLines, stockView)

  // Total con IVA en céntimos → euros (compat orders.amount).
  // Aplicamos también el descuento global (%) sobre la base agregada.
  const totals = cartTotals(
    resolved.map((l) => ({
      priceCents: l.unit_price_cents,
      qty: l.qty,
      discountPct: l.discount_pct,
      vatRate: l.vat_rate,
    })),
    discountGlobalPct,
  )
  const computedAmount = totals.totalCents / 100

  const { data: newOrder, error: insertError } = await admin
    .from('orders')
    .insert({
      customer_name: customerName,
      venue_name: typeof body.venue_name === 'string' ? body.venue_name.trim() || null : null,
      contact_email: contactEmail || null,
      phone: phone || null,
      purchase_type: purchaseType,
      amount: computedAmount,
      discount_global_pct: discountGlobalPct,
      bank_receipt_url: bankReceiptUrl || null,
      requester_name: requesterName || null,
      requester_email: requesterEmail || null,
      ae_ref: typeof body.ae_ref === 'string' ? body.ae_ref.trim() || null : null,
      hubspot_ref: hubspotRef || null,
      // 4 columnas estructuradas (uso primario para TIPSA). Vacias en transferencias_saas.
      shipping_street: req.shipping ? shippingStreet : null,
      shipping_cp: req.shipping ? shippingCp : null,
      shipping_city: req.shipping ? shippingCity : null,
      shipping_province: req.shipping ? (shippingProvince || null) : null,
      // Serializado para compat con vistas legacy. Vacio si no hay envio.
      shipping_address: serializedAddress || null,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      created_by: user.id,
      status: 'nuevo',
      source: 'manual',
    })
    .select('id, operation_id')
    .single()

  if (insertError || !newOrder) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Error al crear el pedido.' },
      { status: 500 }
    )
  }

  // 6. Insert items con snapshot de precio, IVA, descuento y product_id.
  // supplier_qty: unidades que van a proveedor (no reservan stock). La nota
  // lo repite en texto, que es lo que lee quien prepara el envío.
  const { error: itemsError } = await admin.from('order_items').insert(
    resolved.map((line, i) => ({
      order_id: newOrder.id,
      product_id: line.product_id,
      product_name: line.product_name,
      qty: line.qty,
      discount_pct: line.discount_pct,
      unit_price_cents: line.unit_price_cents,
      vat_rate: line.vat_rate,
      supplier_qty: allocation[i].fromSupplier,
      notes:
        [line.notes, supplierNote(allocation[i], line.qty, stockLines[i].product)]
          .filter(Boolean)
          .join(' · ') || null,
    })),
  )

  if (itemsError) {
    console.error('Error inserting order items:', itemsError.message)
  }

  // 6.2 Carrera por la última unidad: si otro pedido entró entre la
  // comprobación de arriba y este insert, ahora algún pool de los que pide
  // este pedido queda en negativo. Se deshace el pedido (las líneas caen en
  // cascada) ANTES de pagos, historial y Slack, y se avisa al comercial.
  if (!stockBypass && !itemsError) {
    const after = toStockView(await loadStockSnapshot(), false)
    // Solo los pools de lo que sale del almacén: lo que va a proveedor no
    // reserva y no puede "sobrevender" nada.
    const fromStock = stockLines.map((l, i) => ({
      product: l.product,
      qty: allocation[i].fromStock,
    }))
    const oversold =
      after.status === 'ok' &&
      [...demandByPool(fromStock, after)].some(
        ([pool, units]) => units > 0 && (after.pools[pool] ?? 0) < 0,
      )
    if (oversold) {
      const { error: rollbackError } = await admin
        .from('orders')
        .delete()
        .eq('id', newOrder.id)
      if (rollbackError) {
        console.error('Error deshaciendo pedido sin stock:', rollbackError.message)
      } else {
        return NextResponse.json(
          {
            error:
              'Otro pedido se ha llevado las últimas unidades mientras confirmabas. No se ha creado el pedido: revisa las cantidades.',
          },
          { status: 409 },
        )
      }
    }
  }

  // 6.5 Financiación: generar los 3 plazos de pago (entrada + 2 plazos).
  // amount_cents (gross) suma exactamente orders.amount. Status inicial
  // 'pendiente'; el equipo Hardware los marca pagados desde la ficha.
  if (isFinancing) {
    const fLine = resolved[0]
    const fProduct = productMap.get(fLine.product_id)
    const installments = fProduct
      ? financingInstallments(fProduct.code, fLine.vat_rate)
      : null
    if (installments) {
      const { error: paymentsError } = await admin.from('order_payments').insert(
        installments.map((inst) => ({
          order_id: newOrder.id,
          installment_no: inst.stage,
          amount_base_cents: inst.baseCents,
          vat_rate: fLine.vat_rate,
          amount_cents: inst.grossCents,
          status: 'pendiente',
        })),
      )
      if (paymentsError) {
        console.error('Error inserting order_payments:', paymentsError.message)
      }
    }
  }

  // 7. Insert initial status_history entry
  const { error: historyError } = await admin.from('status_history').insert({
    order_id: newOrder.id,
    from_status: null,
    to_status: 'nuevo',
    changed_by: user.id,
    changed_at: new Date().toISOString(),
    comment: 'Pedido creado manualmente',
  })

  if (historyError) {
    console.error('Error inserting status_history:', historyError.message)
  }

  // 7.5 A~adir al address_book si la direccion esta estructurada y el tipo
  // de compra exige envio. No bloquea: silencia errores, dedupe natural.
  if (req.shipping && shippingStreet && shippingCp && shippingCity) {
    void upsertAddressFromOrder(admin, {
      name: customerName,
      address: shippingStreet,
      cp: shippingCp,
      city: shippingCity,
      venue_name: typeof body.venue_name === 'string' ? body.venue_name.trim() || null : null,
      province: shippingProvince || null,
      phone: phone || null,
      email: contactEmail || null,
      created_by: user.id,
    })
  }

  // 8. Aviso a Slack (lib/slack.ts → webhook directo; nunca lanza).
  // Resolver el Slack ID del solicitante por requester_email (si tiene
  // perfil en user_profiles con slack_user_id relleno). Si no, sólo @aquí.
  let requesterSlackUserId: string | null = null
  if (requesterEmail) {
    const { data: requesterProfile } = await admin
      .from('user_profiles')
      .select('slack_user_id')
      .eq('email', requesterEmail)
      .maybeSingle()
    requesterSlackUserId = requesterProfile?.slack_user_id ?? null
  }

  const slackResult = await notifyOrderEvent({
    event: 'new_order',
    order_id: newOrder.id,
    operation_id: newOrder.operation_id,
    customer_name: customerName,
    venue_name:
      typeof body.venue_name === 'string' ? body.venue_name.trim() || null : null,
    requester_name: requesterName || null,
    purchase_type: purchaseType,
    amount_cents: Math.round(computedAmount * 100),
    requester_slack_user_id: requesterSlackUserId,
    items_summary: withSupplierWarning(
      formatItemsSummary(
        resolved.map((r) => ({ product_name: r.product_name, qty: r.qty })),
      ),
      resolved.flatMap((r, i) =>
        allocation[i].fromSupplier > 0
          ? [`${r.product_name} ×${allocation[i].fromSupplier}`]
          : [],
      ),
    ),
    shipping_city: req.shipping ? shippingCity || null : null,
    shipping_cp: req.shipping ? shippingCp || null : null,
    hubspot_ref: hubspotRef || null,
    creator_name: profile?.full_name ?? null,
  })
  if (!slackResult.ok) {
    console.error('[slack] new_order falló:', slackResult.error)
  } else if (slackResult.skipped) {
    console.warn('[slack] new_order omitido (webhook no configurado).')
  }

  return NextResponse.json({ id: newOrder.id, operation_id: newOrder.operation_id })
}
