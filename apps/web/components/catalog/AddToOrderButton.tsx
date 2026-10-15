'use client'

import { Check, Minus, Plus } from 'lucide-react'
import { MAX_QTY } from '@/lib/catalog/order-link'

interface AddToOrderButtonProps {
  qty: number
  productName: string
  onAdd: () => void
  onInc: () => void
  onDec: () => void
  /** Selección única (financiación): sin stepper, solo marcar/desmarcar. */
  single?: boolean
  /** Cantidad fija a 1 (productos de precio libre). */
  lockQty?: boolean
  disabled?: boolean
  /** Tope de unidades por stock (lib/stock). Sin tope por defecto. */
  maxQty?: number
}

/**
 * Botón "Añadir" que se convierte en stepper al entrar en el pedido.
 *
 * Todos los controles miden 44px. El ProductTile anterior usaba `h-7 w-7`
 * (28px), por debajo del objetivo táctil accesible — así que esto corrige una
 * regresión existente, no solo replica el origen.
 */
export default function AddToOrderButton({
  qty,
  productName,
  onAdd,
  onInc,
  onDec,
  single = false,
  lockQty = false,
  disabled = false,
  maxQty = Number.POSITIVE_INFINITY,
}: AddToOrderButtonProps) {
  const inOrder = qty > 0

  if (!inOrder) {
    return (
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled || maxQty <= 0}
        className="select-button"
        aria-pressed={false}
        aria-label={`Añadir ${productName} al pedido`}
      >
        <Plus size={17} aria-hidden="true" />
        Añadir
      </button>
    )
  }

  // Selección única o cantidad bloqueada: un solo botón que alterna.
  if (single || lockQty) {
    return (
      <button
        type="button"
        onClick={onDec}
        className="select-button selected"
        aria-pressed
        aria-label={`Quitar ${productName} del pedido`}
      >
        <Check size={17} aria-hidden="true" />
        {single ? 'Seleccionado' : 'Añadido'}
      </button>
    )
  }

  return (
    <div className="qty-stepper">
      <button
        type="button"
        onClick={onDec}
        aria-label={`Quitar una unidad de ${productName}`}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <span aria-live="polite" aria-label={`${qty} unidades de ${productName}`}>
        {qty}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={qty >= Math.min(MAX_QTY, maxQty)}
        aria-label={`Añadir una unidad de ${productName}`}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
