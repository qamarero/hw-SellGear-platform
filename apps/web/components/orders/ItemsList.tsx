'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { OrderItem } from '@/types/database'
import { formatCurrency } from '@/lib/utils'
import {
  effectiveTaxLabel,
  formatEurosCents,
  taxLabel,
  cartTotals,
} from '@/lib/pricing'
import AddOrderItemModal from './AddOrderItemModal'
import ManualAdjustmentModal from './ManualAdjustmentModal'

interface ItemsListProps {
  orderId: string
  items: OrderItem[]
  /** Descuento global (%) del pedido. Se aplica sobre la base imponible
   *  agregada después de los descuentos por línea. Se prorratea por línea
   *  antes del IVA (fiscalmente correcto con IVA mixto). */
  discountGlobalPct?: number | null
  /** Ajuste manual (céntimos) que se resta al total c/IVA. Solo admin edita. */
  manualAdjustmentCents?: number | null
  manualAdjustmentReason?: string | null
  /** Si es admin, se muestra la fila del ajuste manual con botón de editar. */
  isAdmin?: boolean
  readOnly?: boolean
}

export default function ItemsList({
  orderId,
  items,
  discountGlobalPct,
  manualAdjustmentCents,
  manualAdjustmentReason,
  isAdmin,
  readOnly,
}: ItemsListProps) {
  const router = useRouter()
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Estado editable inline para el descuento por línea (uno a la vez).
  const [editingDiscountItemId, setEditingDiscountItemId] = useState<string | null>(null)
  const [editingDiscountValue, setEditingDiscountValue] = useState<string>('')
  const [savingLineDiscount, setSavingLineDiscount] = useState(false)

  // Descuento global: input editable en el tfoot.
  const initialGlobal = discountGlobalPct ?? 0
  const [globalInput, setGlobalInput] = useState<string>(String(initialGlobal))
  const [savingGlobal, setSavingGlobal] = useState(false)
  const globalPctNum = useMemo(() => {
    const n = parseInt(globalInput, 10)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(100, n))
  }, [globalInput])

  // Ajuste manual admin (céntimos que se RESTAN al total c/IVA).
  const manualCents = Math.max(
    0,
    Math.floor(Number(manualAdjustmentCents ?? 0)),
  )

  // Filtrar items con desglose moderno para cálculos precisos con cartTotals.
  const modernItems = useMemo(
    () =>
      items.filter(
        (i) => i.unit_price_cents !== null && i.unit_price_cents !== undefined,
      ),
    [items],
  )
  const hasMixedLegacy = modernItems.length > 0 && modernItems.length < items.length

  // cartTotals calcula todo (descuento por línea + global prorrateado +
  // ajuste manual admin que resta al total c/IVA).
  const totals = useMemo(() => {
    if (modernItems.length === 0) {
      return null
    }
    return cartTotals(
      modernItems.map((i) => ({
        priceCents: i.unit_price_cents as number,
        qty: i.qty,
        discountPct: Number(i.discount_pct ?? 0),
        vatRate: Number(i.vat_rate ?? 21),
      })),
      globalPctNum,
      manualCents,
    )
  }, [modernItems, globalPctNum, manualCents])

  // Desglose por línea (sin descuento global; se muestra en el tfoot agregado).
  const perLine = useMemo(() => {
    return items.map((item) => {
      const upc = item.unit_price_cents
      const hasModern = upc !== null && upc !== undefined
      if (!hasModern) {
        return {
          item,
          hasModern: false,
          unitPriceCents: 0,
          discountPct: 0,
          vatRate: 0,
          taxableCents: 0,
          taxCents: 0,
          totalCents: 0,
        }
      }
      const discountPct = Number(item.discount_pct ?? 0)
      const vatRate = Number(item.vat_rate ?? 21)
      const subtotal = Math.round((upc as number) * item.qty)
      const lineDiscount = Math.round(
        (upc as number) * item.qty * (discountPct / 100),
      )
      const taxable = subtotal - lineDiscount
      const tax = Math.round(taxable * (vatRate / 100))
      return {
        item,
        hasModern: true,
        unitPriceCents: upc as number,
        discountPct,
        vatRate,
        taxableCents: taxable,
        taxCents: tax,
        totalCents: taxable + tax,
      }
    })
  }, [items])

  const vatRates = useMemo(
    () => modernItems.map((i) => Number(i.vat_rate ?? 21)),
    [modernItems],
  )

  async function handleDelete(itemId: string) {
    if (!confirm('¿Eliminar este artículo?')) return

    setDeletingId(itemId)
    setError(null)

    const supabase = createClient()
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId)

    if (deleteError) {
      setError(deleteError.message)
    } else {
      router.refresh()
    }

    setDeletingId(null)
  }

  // Guardar el descuento por línea via PATCH /api/orders/[id]/items/[itemId].
  async function saveLineDiscount(itemId: string, raw: string) {
    const num = parseInt(raw, 10)
    if (!Number.isFinite(num)) {
      setEditingDiscountItemId(null)
      return
    }
    const clamped = Math.max(0, Math.min(100, num))
    setSavingLineDiscount(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount_pct: clamped }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Error al guardar el descuento.')
      } else {
        router.refresh()
      }
    } catch {
      setError('Error de conexión.')
    } finally {
      setSavingLineDiscount(false)
      setEditingDiscountItemId(null)
    }
  }

  // Guardar el descuento global via PATCH /api/orders/[id] (EDITABLE_FIELDS).
  async function saveGlobalDiscount() {
    if (globalPctNum === initialGlobal) return
    setSavingGlobal(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount_global_pct: globalPctNum }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Error al guardar el descuento global.')
        setGlobalInput(String(initialGlobal)) // rollback en UI
      } else {
        router.refresh()
      }
    } catch {
      setError('Error de conexión.')
      setGlobalInput(String(initialGlobal))
    } finally {
      setSavingGlobal(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-900">
          Artículos ({items.length})
        </h3>
        {!readOnly && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Añadir artículo
          </button>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-400 italic">Sin artículos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Producto
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Cant.
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  P. Unit. s/IVA
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Desc.
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Base
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Impuesto
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Total c/IVA
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Notas
                </th>
                {!readOnly && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {perLine.map(({ item, hasModern, unitPriceCents, discountPct, vatRate, taxableCents, taxCents, totalCents }) => (
                <tr key={item.id} className="group">
                  <td className="px-5 py-3 text-sm text-gray-900">
                    {item.product_name ?? '(sin nombre)'}
                    {/* Para quien prepara el envío: estas unidades no salen
                        del almacén, hay que encargarlas (lib/stock). */}
                    {(item.supplier_qty ?? 0) > 0 && (
                      <span
                        className="ml-2 inline-flex rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                        title="Sin stock en el almacén al crear la línea: encargar a proveedor."
                      >
                        A proveedor ×{item.supplier_qty}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-700">
                    {item.qty}
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-gray-700 font-mono tabular-nums">
                    {hasModern
                      ? formatEurosCents(unitPriceCents)
                      : formatCurrency(item.unit_price)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-gray-700">
                    {!hasModern ? (
                      '—'
                    ) : readOnly ? (
                      discountPct > 0 ? `${discountPct}%` : '—'
                    ) : editingDiscountItemId === item.id ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={editingDiscountValue}
                        autoFocus
                        disabled={savingLineDiscount}
                        onChange={(e) => setEditingDiscountValue(e.target.value)}
                        onBlur={() => {
                          if (!savingLineDiscount) {
                            void saveLineDiscount(item.id, editingDiscountValue)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            ;(e.target as HTMLInputElement).blur()
                          } else if (e.key === 'Escape') {
                            setEditingDiscountItemId(null)
                          }
                        }}
                        className="w-16 rounded border border-brand px-1 py-0.5 text-right font-mono text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDiscountItemId(item.id)
                          setEditingDiscountValue(String(discountPct))
                        }}
                        title="Click para editar el descuento (0-100)"
                        className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-brand/5 hover:text-brand"
                      >
                        {discountPct > 0 ? `${discountPct}%` : '—'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-gray-700 font-mono tabular-nums">
                    {hasModern ? formatEurosCents(taxableCents) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-gray-700">
                    {hasModern ? (
                      <span className="font-mono tabular-nums">
                        {formatEurosCents(taxCents)}
                      </span>
                    ) : (
                      '—'
                    )}
                    {hasModern && (
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">
                        {taxLabel(vatRate)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900 font-mono tabular-nums">
                    {hasModern ? formatEurosCents(totalCents) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {item.notes ?? '—'}
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        className="rounded p-1 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed"
                        title="Eliminar artículo"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot className="bg-gray-50/60 border-t border-gray-200">
                {/* Fila: descuento global editable (solo si !readOnly o hay valor) */}
                {(!readOnly || (totals.globalDiscountCents ?? 0) > 0) && (
                  <tr>
                    <td
                      className="px-5 py-2 text-right text-xs font-medium text-gray-500"
                      colSpan={3}
                    >
                      Descuento global sobre el pedido
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {readOnly ? (
                        <span className="text-gray-700">{globalPctNum}%</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={globalInput}
                          disabled={savingGlobal}
                          onChange={(e) => setGlobalInput(e.target.value)}
                          onBlur={() => void saveGlobalDiscount()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              ;(e.target as HTMLInputElement).blur()
                            } else if (e.key === 'Escape') {
                              setGlobalInput(String(initialGlobal))
                            }
                          }}
                          className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right font-mono text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                          title="Descuento global sobre la base imponible (0-100)"
                        />
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-xs text-red-500 font-mono tabular-nums"
                      colSpan={2}
                    >
                      {totals.globalDiscountCents > 0
                        ? `−${formatEurosCents(totals.globalDiscountCents)}`
                        : ''}
                    </td>
                    <td colSpan={2} />
                    {!readOnly && <td />}
                  </tr>
                )}

                {/* Totales */}
                <tr>
                  <td
                    className="px-5 py-2 text-right text-xs font-medium text-gray-500"
                    colSpan={4}
                  >
                    Totales
                    {hasMixedLegacy && (
                      <span className="ml-2 text-[10px] text-gray-400 italic normal-case">
                        (solo líneas con desglose)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-medium text-gray-700 font-mono tabular-nums">
                    {formatEurosCents(totals.taxableCents)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-medium text-gray-700 font-mono tabular-nums">
                    {formatEurosCents(totals.vatCents)}
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">
                      {effectiveTaxLabel(vatRates)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-bold text-gray-900 font-mono tabular-nums">
                    {formatEurosCents(totals.totalCents)}
                  </td>
                  <td />
                  {!readOnly && <td />}
                </tr>

                {/* Ajuste manual (solo se muestra si hay ajuste O si es admin) */}
                {(manualCents > 0 || isAdmin) && (
                  <tr>
                    <td
                      className="px-5 py-1.5 text-right text-[11px] text-gray-500"
                      colSpan={4}
                    >
                      Ajuste manual
                      <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-500">
                        admin
                      </span>
                      {manualCents > 0 && manualAdjustmentReason && (
                        <span
                          className="ml-2 text-[10px] italic text-gray-400"
                          title={manualAdjustmentReason}
                        >
                          {manualAdjustmentReason.length > 40
                            ? `${manualAdjustmentReason.slice(0, 40)}…`
                            : manualAdjustmentReason}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right text-xs font-mono tabular-nums text-red-500"
                      colSpan={2}
                    >
                      {manualCents > 0 ? `−${formatEurosCents(manualCents)}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setShowAdjustmentModal(true)}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-brand ring-1 ring-brand/30 transition-colors hover:bg-brand/5"
                        >
                          {manualCents > 0 ? 'Editar' : 'Aplicar ajuste'}
                        </button>
                      )}
                    </td>
                    <td />
                    {!readOnly && <td />}
                  </tr>
                )}

                {/* Descuentos aplicados (desglose) */}
                {totals.discountCents > 0 && (
                  <tr>
                    <td
                      className="px-5 py-1 text-right text-[11px] text-gray-400"
                      colSpan={4}
                    >
                      Subtotal s/IVA · Descuentos aplicados
                    </td>
                    <td
                      className="px-3 py-1 text-right text-[11px] text-gray-500 font-mono tabular-nums"
                      colSpan={2}
                    >
                      {formatEurosCents(totals.subtotalCents)} ·{' '}
                      <span className="text-red-500">
                        −{formatEurosCents(totals.discountCents)}
                      </span>
                      {totals.globalDiscountCents > 0 && (
                        <span className="ml-1 text-[10px] text-gray-400">
                          (línea {formatEurosCents(totals.lineDiscountCents)} + global {formatEurosCents(totals.globalDiscountCents)})
                        </span>
                      )}
                    </td>
                    <td />
                    <td />
                    {!readOnly && <td />}
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Modal "Añadir artículo" con tabs Catálogo / Línea libre */}
      {showAddModal && (
        <AddOrderItemModal
          orderId={orderId}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Modal ajuste manual (solo admin) */}
      {isAdmin && showAdjustmentModal && (
        <ManualAdjustmentModal
          orderId={orderId}
          currentCents={manualCents}
          currentReason={manualAdjustmentReason ?? null}
          totalBeforeCents={
            totals ? totals.taxableCents + totals.vatCents : 0
          }
          onClose={() => setShowAdjustmentModal(false)}
        />
      )}
    </div>
  )
}
