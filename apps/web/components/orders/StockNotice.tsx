'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { PackageX, X } from 'lucide-react'

interface StockNoticeProps {
  message: string | null
  onClose: () => void
}

/** Cuánto tarda en irse solo. Lo justo para leer una frase. */
const AUTO_DISMISS_MS = 6000

/**
 * Aviso de "no hay stock para eso" en el paso 2.
 *
 * Va POR PORTAL a <body>: lo dispara también el botón flotante del carrito,
 * que vive abajo, y el paso 2 va dentro de un contenedor con
 * `container-type`, que encajonaría un `fixed` (ver ProductDetailModal).
 * Se coloca encima del botón flotante, no tapándolo.
 */
export default function StockNotice({ message, onClose }: StockNoticeProps) {
  // El padre pasa una flecha nueva en cada render: por ref, para que el
  // temporizador dependa solo del mensaje y no se reinicie a cada tecla.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => closeRef.current(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [message])

  if (!message || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-28 left-1/2 z-50 flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-2xl"
    >
      <PackageX size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="-m-1 rounded p-1 text-gray-300 hover:text-white"
        aria-label="Cerrar aviso"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}
