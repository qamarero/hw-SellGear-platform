// =============================================================
// Control de stock: cálculo puro, compartido por servidor y cliente.
//
// El stock físico vive en HWToolbox (otro proyecto Supabase) y solo baja
// cuando alguien registra la transacción de salida, después de enviar. Entre
// la venta y ese registro la unidad sigue "disponible" allí, así que si solo
// mirásemos HWToolbox se podría vender dos veces. Por eso:
//
//   pedible(pool) = disponible en HWToolbox − comprometido en MainOps
//
// donde "comprometido" es, por pedido, lo vendido menos lo que HWToolbox ya
// dio de salida para ese HW-YYYYMM-NNNN. Al registrar la salida, el disponible
// baja y la reserva se libera a la vez: el número no salta.
//
// Un producto tira de uno o varios pools (packs = varios, tabla
// product_stock_components) y dos productos pueden compartir pool (TPV Pro y
// Pack Pro), así que todo se agrega por pool, no por producto.
//
// Los admins no tienen tope (reacondicionados, sustituciones, urgencias),
// pero sus pedidos reservan igual: lo hace get_stock_commitments, que no
// distingue quién creó el pedido.
//
// Productos con proveedor (products.supplier_fallback): nunca bloquean. Se
// sirven primero del almacén y lo que falta se encarga a proveedor; esas
// unidades van a order_items.supplier_qty y no reservan stock. En el stock
// compartido ceden ante los que no tienen alternativa.
//
// Módulo puro, sin 'use client' ni E/S: lo importan route handlers,
// componentes y tests. La carga de datos vive en ./server.ts.
// =============================================================

import type { Product, ProductCategory } from '@/types/database'

/** Categorías sin control de stock: servicios y línea libre. */
const UNCONTROLLED: readonly ProductCategory[] = ['service', 'custom', 'saas_hardware']

/** Umbral a partir del cual la tarjeta avisa de que quedan pocas. */
export const LOW_STOCK = 3

/** Reserva de un pedido enviado mientras HWToolbox no registra la salida. */
export const ENVIADO_RESERVE_DAYS = 15

export interface StockComponent {
  pool: string
  qty: number
}

/**
 * Lo que el servidor manda a las pantallas. Sin números de serie ni
 * artículos: solo lo pedible por pool y de qué pools tira cada producto.
 */
export interface StockView {
  /** 'unavailable' = no se pudo leer el inventario. */
  status: 'ok' | 'unavailable'
  /** Admin: ve el stock pero no tiene tope. */
  bypass: boolean
  /** Pedible por pool (disponible − comprometido). Puede ser negativo. */
  pools: Record<string, number>
  /** Componentes por `products.code`. */
  components: Record<string, StockComponent[]>
}

/** Lo mínimo de un producto que necesita el cálculo de stock. */
export type ProductRef = Pick<
  Product,
  'code' | 'category' | 'name' | 'supplier_fallback' | 'region'
>

export interface StockLine {
  product: ProductRef
  qty: number
}

export function isStockControlled(p: Pick<Product, 'category'>): boolean {
  return !UNCONTROLLED.includes(p.category)
}

/**
 * Producto que, sin stock suficiente, se pide a proveedor
 * (products.supplier_fallback): nunca bloquea. Se sirve primero del almacén
 * y lo que falta va a proveedor — ver allocateStock.
 */
export function isSupplierBacked(
  p: Pick<Product, 'category' | 'supplier_fallback' | 'region'>,
): boolean {
  return isStockControlled(p) && (p.supplier_fallback === true || isSupplierOnly(p))
}

/**
 * Canarias se sirve SIEMPRE desde proveedor: nunca sale de nuestro almacén,
 * así que no consume ni reserva stock, tenga o no componentes. Regla de
 * código y no solo dato, para que un SKU canario nuevo nazca bien.
 */
export function isSupplierOnly(p: Pick<Product, 'region'>): boolean {
  return p.region === 'canarias'
}

/**
 * Líneas que SÍ dependen del almacén. Tienen prioridad sobre el stock
 * compartido: los productos con proveedor ceden, porque tienen alternativa.
 * (Pack Premium y una Impresora WiFi suelta comparten impresoras: la suelta
 * no puede ir a proveedor, el pack sí.)
 */
function strictLines(lines: readonly StockLine[]): StockLine[] {
  return lines.filter((l) => isStockControlled(l.product) && !isSupplierBacked(l.product))
}

/**
 * Líneas del carrito del wizard (por product_id) a líneas de stock. Las
 * líneas libres y los productos que no están en la lista se ignoran.
 */
export function toStockLines(
  items: readonly { product_id: string | null; qty: number }[],
  products: readonly Product[],
): StockLine[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  const out: StockLine[] = []
  for (const it of items) {
    const product = it.product_id ? byId.get(it.product_id) : undefined
    if (product) out.push({ product, qty: it.qty })
  }
  return out
}

/** Unidades que pide cada pool para un conjunto de líneas. */
export function demandByPool(
  lines: readonly StockLine[],
  view: Pick<StockView, 'components'>,
): Map<string, number> {
  const demand = new Map<string, number>()
  for (const { product, qty } of lines) {
    if (!isStockControlled(product)) continue
    for (const c of view.components[product.code] ?? []) {
      demand.set(c.pool, (demand.get(c.pool) ?? 0) + qty * c.qty)
    }
  }
  return demand
}

/**
 * Cuántas unidades MÁS de `product` caben, dada una demanda ya comprometida
 * en el carrito. Infinity si el producto no tiene control de stock.
 *
 * Puede ser negativo: el carrito ya pide más de lo que hay (el stock bajó
 * mientras se editaba). Producto físico sin componentes, o inventario caído:
 * 0 — no hay forma de saber que existe.
 */
export function productHeadroom(
  product: ProductRef,
  demand: ReadonlyMap<string, number>,
  view: Pick<StockView, 'status' | 'pools' | 'components'>,
): number {
  if (!isStockControlled(product)) return Number.POSITIVE_INFINITY
  if (view.status !== 'ok') return 0
  const comps = view.components[product.code] ?? []
  if (comps.length === 0) return 0
  let headroom = Number.POSITIVE_INFINITY
  for (const c of comps) {
    const free = (view.pools[c.pool] ?? 0) - (demand.get(c.pool) ?? 0)
    headroom = Math.min(headroom, Math.floor(free / c.qty))
  }
  return headroom
}

/** Pedible de un producto sin contar ningún carrito (≥ 0, o Infinity). */
export function productAvailable(product: ProductRef, view: StockView): number {
  return Math.max(0, productHeadroom(product, new Map(), view))
}

/** Estado de stock de un producto para pintar su tarjeta. */
export interface ProductStockState {
  controlled: boolean
  /** Sin stock se pide a proveedor: sin tope y nunca bloqueado. */
  supplier: boolean
  /** Inventario caído: no se sabe cuánto hay. */
  unknown: boolean
  bypass: boolean
  /** Pedible sin contar el carrito (Infinity si no hay control). */
  available: number
  /** Tope de unidades de este producto en el carrito (Infinity sin tope). */
  maxQty: number
}

export function productStockState(
  product: ProductRef,
  cart: readonly StockLine[],
  view: StockView,
): ProductStockState {
  const controlled = isStockControlled(product)
  const supplier = isSupplierBacked(product)
  // Canarias no tira del almacén: aunque haya stock, para ella es 0.
  const available = isSupplierOnly(product) ? 0 : productAvailable(product, view)
  const inCart = cart
    .filter((l) => l.product.code === product.code)
    .reduce((acc, l) => acc + l.qty, 0)
  // Solo las líneas de almacén restan: las de proveedor ceden el stock.
  const headroom = productHeadroom(product, demandByPool(strictLines(cart), view), view)
  return {
    controlled,
    supplier,
    unknown: controlled && view.status !== 'ok',
    bypass: view.bypass,
    available,
    maxQty:
      view.bypass || !controlled || supplier
        ? Number.POSITIVE_INFINITY
        : Math.max(0, inCart + headroom),
  }
}

/** Texto corto del estado, o null si no hay nada que avisar. */
export function stockBadge(s: ProductStockState): string | null {
  if (!s.controlled) return null
  if (s.supplier && (s.unknown || s.available <= 0)) return 'A proveedor'
  if (s.unknown) return 'Stock sin comprobar'
  if (s.available <= 0) return 'Sin stock'
  if (s.available <= LOW_STOCK) return `Quedan ${s.available}`
  return null
}

/** Cómo se pinta la tarjeta según su stock. */
export interface StockLook {
  /**
   * No se puede añadir: tarjeta en gris y etiqueta fija en lugar del botón.
   * Nunca para un admin, ni si ya hay unidades en el carrito (tienen que
   * poder quitarse).
   */
  blocked: boolean
  /** Texto de esa etiqueta. */
  blockedLabel: string | null
  /** Quedan pocas (≤ LOW_STOCK): marco ámbar. */
  low: boolean
}

export function stockLook(
  s: ProductStockState | undefined,
  inCart: number,
): StockLook {
  if (!s || !s.controlled) return { blocked: false, blockedLabel: null, low: false }
  const blocked = !s.bypass && !s.supplier && inCart === 0 && s.maxQty <= 0
  return {
    blocked,
    blockedLabel: !blocked
      ? null
      : s.unknown || s.available <= 0
        ? 'No disponible'
        : // Hay stock, pero el resto del pedido ya se lo lleva (pool compartido).
          'Agotado en este pedido',
    low: !s.unknown && s.available > 0 && s.available <= LOW_STOCK,
  }
}

export type StockCheck = { ok: true } | { ok: false; error: string }

const UNAVAILABLE_ERROR =
  'No se ha podido comprobar el stock ahora mismo. Inténtalo en unos minutos o pide el pedido a un admin.'

/**
 * ¿Cabe este carrito en el stock? Cada producto se comprueba contra la
 * demanda del RESTO del carrito, porque comparten pools: 2 TPV Pro + 1 Pack
 * Pro con 2 TPV Pro pedibles no cabe aunque cada línea por sí sola sí.
 *
 * Los productos con proveedor nunca fallan, y tampoco restan a los demás:
 * ceden el stock compartido (ver strictLines).
 */
export function validateStock(
  lines: readonly StockLine[],
  view: StockView,
): StockCheck {
  if (view.bypass) return { ok: true }

  const strict = strictLines(lines)
  const qtyByCode = new Map<string, { product: ProductRef; qty: number }>()
  for (const l of strict) {
    const prev = qtyByCode.get(l.product.code)
    qtyByCode.set(l.product.code, {
      product: l.product,
      qty: (prev?.qty ?? 0) + l.qty,
    })
  }
  if (qtyByCode.size === 0) return { ok: true }
  if (view.status !== 'ok') return { ok: false, error: UNAVAILABLE_ERROR }

  for (const { product, qty } of qtyByCode.values()) {
    const others = strict.filter((l) => l.product.code !== product.code)
    const headroom = productHeadroom(product, demandByPool(others, view), view)
    if (qty <= headroom) continue
    const max = Math.max(0, headroom)
    if ((view.components[product.code] ?? []).length === 0) {
      return {
        ok: false,
        error: `«${product.name}» no tiene stock registrado en el almacén.`,
      }
    }
    return {
      ok: false,
      error:
        max === 0
          ? `«${product.name}» está sin stock.`
          : `Solo quedan ${max} de «${product.name}» para este pedido (has pedido ${qty}).`,
    }
  }
  return { ok: true }
}

/**
 * Guarda de un cambio en el carrito. Deja pasar todo lo que no aumente
 * unidades (quitar, bajar, cambiar descuento), aunque el carrito siga sin
 * cuadrar: si el stock bajó mientras se editaba, el comercial tiene que
 * poder arreglarlo. Lo que suma unidades solo pasa si el resultado cabe.
 */
export function guardStockChange(
  prev: readonly StockLine[],
  next: readonly StockLine[],
  view: StockView,
): StockCheck {
  if (view.bypass) return { ok: true }
  // Solo cuentan los de almacén: subir un producto con proveedor nunca se
  // bloquea, y como cede el stock tampoco puede dejar sin hueco a otro.
  const sum = (lines: readonly StockLine[]) => {
    const m = new Map<string, number>()
    for (const l of strictLines(lines)) {
      m.set(l.product.code, (m.get(l.product.code) ?? 0) + l.qty)
    }
    return m
  }
  const before = sum(prev)
  const grew = [...sum(next)].some(([code, qty]) => qty > (before.get(code) ?? 0))
  if (!grew) return { ok: true }
  return validateStock(next, view)
}

/** Reparto de una línea entre almacén y proveedor. */
export interface LineAllocation {
  fromStock: number
  fromSupplier: number
  /** Inventario caído: no se sabe qué sale del almacén. */
  unknown: boolean
}

/**
 * Cuánto de cada línea sale del almacén y cuánto va a proveedor, en el mismo
 * orden que `lines`.
 *
 *   · Líneas de almacén (y servicios): todo del almacén. Van primero: tienen
 *     prioridad sobre el stock compartido.
 *   · Líneas con proveedor: se sirve del almacén lo que quede, en orden, y el
 *     resto va a proveedor.
 *
 * El servidor lo usa al crear la línea para fijar order_items.supplier_qty
 * (que deja de reservar stock) y la nota para quien prepara el pedido.
 */
export function allocateStock(
  lines: readonly StockLine[],
  view: Pick<StockView, 'status' | 'pools' | 'components'>,
): LineAllocation[] {
  const demand = demandByPool(strictLines(lines), view)
  return lines.map(({ product, qty }) => {
    if (!isSupplierBacked(product)) {
      return { fromStock: qty, fromSupplier: 0, unknown: false }
    }
    // Canarias: todo a proveedor, se sepa o no el stock.
    if (isSupplierOnly(product)) {
      return { fromStock: 0, fromSupplier: qty, unknown: false }
    }
    if (view.status !== 'ok') {
      return { fromStock: qty, fromSupplier: 0, unknown: true }
    }
    const fromStock = Math.min(qty, Math.max(0, productHeadroom(product, demand, view)))
    for (const c of view.components[product.code] ?? []) {
      demand.set(c.pool, (demand.get(c.pool) ?? 0) + fromStock * c.qty)
    }
    return { fromStock, fromSupplier: qty - fromStock, unknown: false }
  })
}

/**
 * Nota de la línea para quien prepara el pedido (order_items.notes), o null
 * si todo sale del almacén.
 */
export function supplierNote(
  a: LineAllocation,
  qty: number,
  product?: Pick<Product, 'region'>,
): string | null {
  if (product && isSupplierOnly(product)) {
    return 'Canarias: pedir a proveedor, no sale de nuestro almacén.'
  }
  if (a.unknown) {
    return 'Stock sin comprobar al crear la línea: confirmar si sale del almacén o se pide a proveedor.'
  }
  if (a.fromSupplier <= 0) return null
  return a.fromSupplier === qty
    ? 'A pedir a proveedor: sin stock en almacén.'
    : `A pedir a proveedor: ${a.fromSupplier} de ${qty} ud. (sin stock suficiente en almacén).`
}

// -------------------------------------------------------------
// Cálculo de pools en servidor (a partir de lo que devuelven las RPC)
// -------------------------------------------------------------

export interface PoolDef {
  key: string
  label: string
  article_ids: string[]
}

export interface ComponentRow {
  product_code: string
  pool_key: string
  quantity: number
}

export interface CommitmentRow {
  operation_id: string
  status: string
  product_code: string
  qty: number
}

export interface ExitRow {
  mainops_operation_id: string
  article_id: string
  unidades: number
}

export interface PoolStock {
  key: string
  label: string
  /** Unidades nuevas disponibles en HWToolbox. */
  available: number
  /** Vendido en MainOps y aún no descontado en HWToolbox. */
  committed: number
  /** available − committed (puede ser negativo). */
  orderable: number
}

export interface PendingExit {
  operation_id: string
  /** Unidades enviadas cuya salida falta por registrar en HWToolbox. */
  units: number
}

export interface StockComputation {
  pools: PoolStock[]
  components: Record<string, StockComponent[]>
  /** Pedidos `enviado` que aún retienen reserva: falta su salida. */
  pendingExits: PendingExit[]
}

export function componentsByCode(
  rows: readonly ComponentRow[],
): Record<string, StockComponent[]> {
  const out: Record<string, StockComponent[]> = {}
  for (const r of rows) {
    ;(out[r.product_code] ??= []).push({ pool: r.pool_key, qty: r.quantity })
  }
  return out
}

/**
 * Pools con disponible, comprometido y pedible.
 *
 * Reserva de un pedido en un pool = max(0, demanda − salidas ya registradas
 * de artículos de ese pool). Así una salida parcial libera solo su parte, y
 * un equipo reacondicionado que sale por un pedido también lo libera: cuenta
 * el artículo, no su condición.
 */
export function computePools(input: {
  pools: readonly PoolDef[]
  components: readonly ComponentRow[]
  availableByArticle: ReadonlyMap<string, number>
  commitments: readonly CommitmentRow[]
  exits: readonly ExitRow[]
}): StockComputation {
  const components = componentsByCode(input.components)

  const poolsOfArticle = new Map<string, string[]>()
  for (const p of input.pools) {
    for (const a of p.article_ids) {
      ;(poolsOfArticle.get(a) ?? poolsOfArticle.set(a, []).get(a)!).push(p.key)
    }
  }

  const exited = new Map<string, Map<string, number>>()
  for (const e of input.exits) {
    for (const pool of poolsOfArticle.get(e.article_id) ?? []) {
      const byPool = exited.get(e.mainops_operation_id) ?? new Map()
      byPool.set(pool, (byPool.get(pool) ?? 0) + Number(e.unidades))
      exited.set(e.mainops_operation_id, byPool)
    }
  }

  const demand = new Map<string, Map<string, number>>()
  const statusOf = new Map<string, string>()
  for (const c of input.commitments) {
    statusOf.set(c.operation_id, c.status)
    for (const comp of components[c.product_code] ?? []) {
      const byPool = demand.get(c.operation_id) ?? new Map()
      byPool.set(comp.pool, (byPool.get(comp.pool) ?? 0) + Number(c.qty) * comp.qty)
      demand.set(c.operation_id, byPool)
    }
  }

  const committed = new Map<string, number>()
  const pendingExits: PendingExit[] = []
  for (const [op, byPool] of demand) {
    let units = 0
    for (const [pool, d] of byPool) {
      const reserved = Math.max(0, d - (exited.get(op)?.get(pool) ?? 0))
      committed.set(pool, (committed.get(pool) ?? 0) + reserved)
      units += reserved
    }
    if (statusOf.get(op) === 'enviado' && units > 0) {
      pendingExits.push({ operation_id: op, units })
    }
  }
  pendingExits.sort((a, b) => a.operation_id.localeCompare(b.operation_id))

  const pools = input.pools.map((p) => {
    const available = p.article_ids.reduce(
      (acc, a) => acc + (input.availableByArticle.get(a) ?? 0),
      0,
    )
    const c = committed.get(p.key) ?? 0
    return { key: p.key, label: p.label, available, committed: c, orderable: available - c }
  })

  return { pools, components, pendingExits }
}
