'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Product } from '@/types/database'
import { isFreePrice } from '@/lib/product-rules'
import CatalogRoot from './CatalogRoot'
import ProductDetail from './ProductDetail'
import type { ProductStockState } from '@/lib/stock/compute'

interface ProductDetailModalProps {
  product: Product
  qty: number
  onClose: () => void
  onAdd: (product: Product) => void
  onInc: (product: Product) => void
  onDec: (product: Product) => void
  stock?: ProductStockState
}

/**
 * Ficha de producto dentro del wizard.
 *
 * Va POR PORTAL a <body> a propósito: el contenedor del paso 2 lleva
 * `container-type: inline-size` para las container queries, y eso crea
 * contexto de posicionamiento para descendientes `fixed` — un overlay
 * `fixed inset-0` se quedaría encajonado dentro de la caja del catálogo.
 * Se envuelve en CatalogRoot SIN `fluid` para tener los tokens sin
 * containment.
 */
export default function ProductDetailModal({
  product,
  qty,
  onClose,
  onAdd,
  onInc,
  onDec,
  stock,
}: ProductDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trampa de foco: el diálogo es modal, tabular no debe salirse.
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previous?.focus()
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
      onMouseDown={onClose}
    >
      <CatalogRoot>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Ficha de ${product.name}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-3">
            <h2 className="text-base font-semibold text-gray-900">
              {product.name}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="icon-button"
              aria-label="Cerrar ficha"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[80vh] overflow-y-auto">
            <ProductDetail
              product={product}
              qty={qty}
              onAdd={onAdd}
              onInc={onInc}
              onDec={onDec}
              lockQty={isFreePrice(product)}
              stock={stock}
            />
          </div>
        </div>
      </CatalogRoot>
    </div>,
    document.body,
  )
}
