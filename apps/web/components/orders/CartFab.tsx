'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Package, Plus, X } from 'lucide-react'
import type { Product } from '@/types/database'
import { cartTotals, effectiveTaxLabel, formatEurosCents } from '@/lib/pricing'
import { isFreePrice } from '@/lib/product-rules'
import { cartLineDetails, totalsInput } from '@/lib/cart-detail'
import {
  applyAdjustQty,
  applyRemoveLine,
  type CartLineState,
} from '@/lib/catalog/rules'
import ProductThumb from '@/components/catalog/ProductThumb'

interface CartFabProps {
  items: CartLineState[]
  products: Product[]
  onItemsChange: (items: CartLineState[]) => void
  vatRateOverride?: number | null
  discountGlobalPct?: number
  /** Para arrastrar la tablet regalo si se retira Implementación Pro. */
  implPro?: Product | null
  tablet?: Product | null
}

/**
 * Botón flotante con el carrito, y su detalle en popup.
 *
 * Las tarjetas del catálogo son altas a propósito (foto grande, bullets,
 * desglose del pack), así que el resumen del pedido queda muy por debajo del
 * pliegue: para comprobar qué llevas había que scrollear todo el catálogo.
 * Esto lo pone a un clic desde cualquier punto.
 *
 * Va POR PORTAL a <body>: el contenedor del paso 2 lleva
 * `container-type: inline-size` para las container queries, y eso crea
 * contexto de posicionamiento para descendientes `fixed` — sin el portal, el
 * botón quedaría anclado a la caja del catálogo en vez de a la ventana.
 *
 * Los totales salen de `cartTotals`, el mismo helper que usa CartSummary, así
 * que no pueden divergir del resumen de abajo por un redondeo distinto.
 */
export default function CartFab({
  items,
  products,
  onItemsChange,
  vatRateOverride = null,
  discountGlobalPct = 0,
  implPro = null,
  tablet = null,
}: CartFabProps) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // El detalle por línea sale de lib/cart-detail, el mismo que usan
  // CartSummary y la revisión final: así el popup no puede contar una cosa y
  // el resumen de abajo otra.
  const detalle = cartLineDetails(items, products, vatRateOverride)
  const computed = totalsInput(detalle)
  const totals = cartTotals(computed, discountGlobalPct)

  const unidades = items.reduce((n, l) => n + l.qty, 0)
  const pendientes = detalle.filter((d) => d.pendingPrice).length

  // Escape para cerrar, foco inicial y bloqueo del scroll de fondo.
  useEffect(() => {
    if (!open) return
    const previo = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previo?.focus()
    }
  }, [open])

  if (typeof document === 'undefined') return null
  // Sin líneas no hay nada que mirar: un botón a 0 solo sería ruido.
  if (items.length === 0) return null

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ver el pedido: ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}, ${formatEurosCents(totals.totalCents)}`}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full bg-cta px-5 py-3.5 text-white shadow-lg transition-all hover:bg-cta-hover hover:shadow-xl"
      >
        <span className="relative flex items-center">
          <Package size={22} aria-hidden="true" />
          <span className="absolute -right-2.5 -top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 font-mono text-[11px] font-bold text-cta">
            {unidades}
          </span>
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-bold">Ver el pedido</span>
          <span className="block font-mono text-xs opacity-90">
            {formatEurosCents(totals.totalCents)}
          </span>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 sm:items-center sm:p-6"
          onMouseDown={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Detalle del pedido"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Tu pedido</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {items.length} {items.length === 1 ? 'línea' : 'líneas'} ·{' '}
                  {unidades} {unidades === 1 ? 'unidad' : 'unidades'} · importes
                  s/IVA
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar el detalle"
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
              {detalle.map((d) => (
                <li key={d.index} className="flex items-center gap-3 px-5 py-3">
                  {d.product ? (
                    <ProductThumb product={d.product} size={44} />
                  ) : (
                    <span className="h-11 w-11 shrink-0 rounded-md bg-gray-100" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {d.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {d.pendingPrice ? (
                        <span className="text-brand-hover">
                          Falta el precio acordado
                        </span>
                      ) : (
                        <>
                          {d.line.qty} × {formatEurosCents(d.unitPriceCents)}
                          {d.line.discount_pct > 0 && (
                            <span className="ml-1 text-brand-hover">
                              {d.isGift
                                ? '· 🎁 regalo'
                                : `· −${d.line.discount_pct} %`}
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Solo las líneas de catálogo llevan stepper: las libres se
                      editan en su propio bloque, con descripción y precio. El
                      regalo tampoco lo lleva: es una unidad y solo una, así que
                      el único control que tiene sentido ahí es retirarlo. Una
                      segunda tablet se añade desde el catálogo y se cobra. */}
                  {d.product && !isFreePrice(d.product) && !d.isGift ? (
                    <div className="flex shrink-0 items-center rounded-lg ring-1 ring-gray-200">
                      <button
                        type="button"
                        onClick={() =>
                          onItemsChange(
                            applyAdjustQty(items, d.product!.id, -1, {
                              implPro,
                              tablet,
                            }),
                          )
                        }
                        aria-label={`Quitar una unidad de ${d.name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-l-lg text-gray-600 transition-colors hover:bg-gray-100"
                      >
                        <Minus size={15} aria-hidden="true" />
                      </button>
                      <span className="min-w-8 text-center font-mono text-sm font-semibold text-gray-900">
                        {d.line.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onItemsChange(applyAdjustQty(items, d.product!.id, 1))
                        }
                        aria-label={`Añadir una unidad de ${d.name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-r-lg text-gray-600 transition-colors hover:bg-gray-100"
                      >
                        <Plus size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onItemsChange(applyRemoveLine(items, d.index))}
                      aria-label={`Quitar ${d.name} del pedido`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}

                  <span className="w-20 shrink-0 text-right font-mono text-sm font-semibold text-gray-900">
                    {d.pendingPrice ? '—' : formatEurosCents(d.netCents)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5 border-t border-gray-200 bg-gray-50 px-5 py-4">
              <Fila label="Base" value={formatEurosCents(totals.subtotalCents)} />
              {totals.lineDiscountCents > 0 && (
                <Fila
                  label="Descuentos por línea"
                  value={`− ${formatEurosCents(totals.lineDiscountCents)}`}
                  acento
                />
              )}
              {totals.globalDiscountCents > 0 && (
                <Fila
                  label={`Descuento global (${discountGlobalPct} %)`}
                  value={`− ${formatEurosCents(totals.globalDiscountCents)}`}
                  acento
                />
              )}
              <Fila
                label={effectiveTaxLabel(computed.map((c) => c.vatRate))}
                value={formatEurosCents(totals.vatCents)}
              />
              <div className="flex items-baseline justify-between border-t border-gray-200 pt-2">
                <span className="text-sm font-semibold text-gray-900">Total</span>
                <span className="font-mono text-lg font-bold text-gray-900">
                  {formatEurosCents(totals.totalCents)}
                </span>
              </div>
              {pendientes > 0 && (
                <p className="pt-1 text-xs text-brand-hover">
                  {pendientes} {pendientes === 1 ? 'línea' : 'líneas'} sin precio:
                  el total todavía no las incluye.
                </p>
              )}
              <p className="pt-1 text-[11px] leading-snug text-gray-500">
                El IVA definitivo depende del código postal de envío, que se pide
                en el paso siguiente.
              </p>
            </div>

            <div className="border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cta-hover"
              >
                Seguir añadiendo
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}

function Fila({
  label,
  value,
  acento = false,
}: {
  label: string
  value: string
  acento?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-mono ${acento ? 'text-brand-hover' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  )
}
