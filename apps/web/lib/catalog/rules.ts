// =============================================================
// Reglas del carrito como funciones puras.
//
// Estas reglas vivían dentro de ProductCatalog.tsx (líneas 78-236), así que
// solo existían para el paso 2 del wizard: la ruta /catalogo no podía
// reutilizarlas, y AddOrderItemModal se vio obligado a reimplementar la del
// regalo de tablet por su cuenta. Al ser reducers puros sobre
// CartLineState[] se comparten entre las tres superficies y son testeables
// sin renderizar nada.
//
// CartLineState y EMPTY_LINE se definen AQUÍ (y CartLine.tsx los reexporta
// por compatibilidad): el estado del carrito es un dato, no un detalle de un
// componente, y así este módulo no depende de React.
// =============================================================

import type { Product } from '@/types/database'
import { referencePriceCents } from '@/lib/product-rules'

export interface CartLineState {
  product_id: string | null
  product_name_override: string
  unit_price_override_cents: number | null
  qty: number
  /**
   * Descuento por línea. Rango libre 0-100 entero. Los productos con
   * `allows_discount = false` fuerzan 0 (ver lib/product-rules.ts). La
   * financiación también rechaza != 0 en POST /api/orders.
   */
  discount_pct: number
  /**
   * Nota de la línea, tal cual va a `order_items.notes`.
   *
   * En la ficha del pedido es la columna que lee quien prepara el envío, y es
   * lo único que explica una línea a 0 €: sin ella la tablet de regalo parece
   * un error de precio y se queda sin enviar. La pone `applyAddTabletGift`;
   * el wizard no tiene campo libre para el resto de líneas.
   */
  notes: string | null
}

export const EMPTY_LINE: CartLineState = {
  product_id: null,
  product_name_override: '',
  unit_price_override_cents: null,
  qty: 1,
  discount_pct: 0,
  notes: null,
}

// -------------------------------------------------------------
// SKU con reglas propias
// -------------------------------------------------------------

/** Servicio de implementación: al añadirlo se pregunta por la tablet regalo. */
export const IMPL_PRO_CODE = 'implementacion-pro'
/** Tablet que se regala con Implementación Pro (línea con descuento 100 %). */
export const TABLET_GIFT_CODE = 'tablet-kds-lenovo'
/** Nota que deja rastro del regalo en la ficha del pedido. */
export const TABLET_GIFT_NOTE = 'Regalo por Implementación Pro'
/** Descuento que marca una línea como regalo. */
export const GIFT_DISCOUNT_PCT = 100

// -------------------------------------------------------------
// Consultas
// -------------------------------------------------------------

export function findByCode(products: Product[], code: string): Product | null {
  return products.find((p) => p.code === code) ?? null
}

/** Mapa product_id -> unidades en el carrito, para el badge de la tarjeta. */
export function qtyByProduct(items: CartLineState[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const it of items) {
    if (!it.product_id) continue
    map.set(it.product_id, (map.get(it.product_id) ?? 0) + it.qty)
  }
  return map
}

export function hasProduct(items: CartLineState[], productId: string): boolean {
  return items.some((it) => it.product_id === productId)
}

/**
 * Una línea es regalo si lleva el 100 % de descuento. Esa es la única marca
 * que hay: el servidor no distingue un regalo de un descuento manual del
 * 100 %, así que en la BD son la misma fila.
 */
export function isGiftLine(line: CartLineState): boolean {
  return line.discount_pct === GIFT_DISCOUNT_PCT
}

/**
 * Índice de la línea DE PAGO de un producto, o -1.
 *
 * Salta las líneas de regalo a propósito: el regalo es una unidad y solo una,
 * la que justifica Implementación Pro. Las unidades que se añadan después van
 * a su propia línea, a precio normal. Sin esto, añadir la misma tablet desde
 * el catálogo sumaba unidades a la línea regalada y se regalaban todas.
 */
function payableIndex(items: CartLineState[], productId: string): number {
  return items.findIndex(
    (it) => it.product_id === productId && !isGiftLine(it),
  )
}

/**
 * Índice de la línea de tablet regalo, o -1. Se identifica por SKU +
 * descuento 100 % (ver `isGiftLine`).
 */
export function tabletGiftIndex(
  items: CartLineState[],
  tablet: Product | null,
): number {
  if (!tablet) return -1
  return items.findIndex(
    (it) => it.product_id === tablet.id && isGiftLine(it),
  )
}

// -------------------------------------------------------------
// Reducers — siempre devuelven un array nuevo, nunca mutan
// -------------------------------------------------------------

/**
 * Añade el producto, o suma 1 si ya está en el carrito.
 *
 * Los productos de precio libre CON tarifa (Implementación Pro, 500 €) entran
 * con el importe ya puesto: es el precio de la oferta y lo normal es no
 * tocarlo, pero el AE puede ajustarlo o descontarlo desde la línea. Los que
 * no tienen tarifa entran a `null` y el paso 2 no deja continuar hasta que se
 * rellenen.
 *
 * Las unidades se suman a la línea de pago, nunca a una de regalo: si el
 * pedido ya lleva la tablet regalada por Implementación Pro y se añade otra
 * desde el catálogo, la segunda abre línea propia y se cobra.
 */
export function applyAddProduct(
  items: CartLineState[],
  product: Product,
  qty = 1,
): CartLineState[] {
  const idx = payableIndex(items, product.id)
  if (idx >= 0) {
    const next = [...items]
    next[idx] = { ...next[idx], qty: next[idx].qty + qty }
    return next
  }
  return [
    ...items,
    {
      ...EMPTY_LINE,
      product_id: product.id,
      qty,
      unit_price_override_cents: referencePriceCents(product),
    },
  ]
}

/**
 * Suma `delta` a la cantidad. Si llega a 0 la línea se elimina, y si el
 * producto retirado era Implementación Pro se retira TAMBIÉN la tablet
 * regalo: quedaría una tablet gratis sin el servicio que la justifica.
 *
 * Trabaja sobre la línea de pago. Solo cae en la de regalo cuando no hay otra,
 * para que restar desde el catálogo pueda retirar la tablet regalada.
 *
 * NO sube la cantidad de un regalo: la segunda unidad se cobra y va en línea
 * aparte, y crearla necesita el `Product` (precio de referencia), que aquí no
 * tenemos. Para sumar unidades usa siempre `applyAddProduct`, que sabe hacerlo.
 */
export function applyAdjustQty(
  items: CartLineState[],
  productId: string,
  delta: number,
  ctx: { implPro?: Product | null; tablet?: Product | null } = {},
): CartLineState[] {
  const payable = payableIndex(items, productId)
  const idx =
    payable >= 0 ? payable : items.findIndex((it) => it.product_id === productId)
  if (idx < 0) return items
  if (delta > 0 && isGiftLine(items[idx])) return items

  const newQty = items[idx].qty + delta
  if (newQty > 0) {
    const next = [...items]
    next[idx] = { ...next[idx], qty: newQty }
    return next
  }

  let next = items.filter((_, i) => i !== idx)
  const { implPro, tablet } = ctx
  if (implPro && tablet && productId === implPro.id) {
    next = next.filter(
      (it) =>
        !(it.product_id === tablet.id && it.discount_pct === GIFT_DISCOUNT_PCT),
    )
  }
  return next
}

/**
 * Añade la tablet como regalo (descuento 100 %). Idempotente.
 *
 * La nota viaja a `order_items.notes` y es imprescindible: en la ficha del
 * pedido es lo único que distingue el regalo de un descuento del 100 % puesto
 * por error, así que sin ella quien prepara el envío no sabe que la tablet
 * entra en el paquete.
 */
export function applyAddTabletGift(
  items: CartLineState[],
  tablet: Product | null,
): CartLineState[] {
  if (!tablet || tabletGiftIndex(items, tablet) >= 0) return items
  return [
    ...items,
    {
      ...EMPTY_LINE,
      product_id: tablet.id,
      qty: 1,
      discount_pct: GIFT_DISCOUNT_PCT,
      notes: TABLET_GIFT_NOTE,
    },
  ]
}

/** Quita la línea de tablet regalo si la hubiera. */
export function applyDeclineTabletGift(
  items: CartLineState[],
  tablet: Product | null,
): CartLineState[] {
  const idx = tabletGiftIndex(items, tablet)
  return idx >= 0 ? items.filter((_, i) => i !== idx) : items
}

/** Línea en blanco para producto fuera de catálogo u oferta mixta. */
export function applyAddFreeLine(items: CartLineState[]): CartLineState[] {
  return [...items, { ...EMPTY_LINE }]
}

export function applyUpdateLine(
  items: CartLineState[],
  index: number,
  partial: Partial<CartLineState>,
): CartLineState[] {
  return items.map((it, i) => (i === index ? { ...it, ...partial } : it))
}

export function applyRemoveLine(
  items: CartLineState[],
  index: number,
): CartLineState[] {
  return items.filter((_, i) => i !== index)
}

/**
 * Financiación: selección única. Reemplaza el carrito entero por una sola
 * línea con cantidad 1 y sin descuento, que es lo que valida
 * POST /api/orders para `hardware_financiacion`.
 */
export function applySelectFinanced(product: Product): CartLineState[] {
  return [{ ...EMPTY_LINE, product_id: product.id, qty: 1, discount_pct: 0 }]
}
