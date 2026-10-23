'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { PICKUP_REASON_LABELS } from '@/lib/pickups/status'
import type { PickupDestinationType, PickupReason } from '@/types/database'

interface NewPickupModalProps {
  onClose: () => void
}

const INPUT =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

const MANUAL_REASONS: PickupReason[] = ['devolucion', 'baja', 'cambio', 'rma', 'otro']

/**
 * Alta manual: recogidas que no vienen de un RMA de HSM (devoluciones de
 * compra, bajas, equipos antiguos). Queda «solicitada» y se programa con el
 * mismo boton que las de HSM.
 */
export default function NewPickupModal({ onClose }: NewPickupModalProps) {
  const router = useRouter()
  const [reason, setReason] = useState<PickupReason>('devolucion')
  const [origin, setOrigin] = useState({ name: '', contact_name: '', phone: '', address: '', postal_code: '', city: '' })
  const [destType, setDestType] = useState<PickupDestinationType>('oficina')
  const [dest, setDest] = useState({ name: '', contact_name: '', phone: '', address: '', postal_code: '', city: '' })
  const [itemsText, setItemsText] = useState('')
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [loading, onClose])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)
      try {
        const res = await fetch('/api/pickups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason,
            origin,
            destination: destType === 'sat' ? { type: 'sat', ...dest } : { type: 'oficina' },
            items: itemsText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((description) => ({ description })),
            instructions: instructions.trim() || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Error creando la recogida')
          return
        }
        router.refresh()
        onClose()
      } catch {
        setError('Error de conexión. Inténtalo de nuevo.')
      } finally {
        setLoading(false)
      }
    },
    [reason, origin, destType, dest, itemsText, instructions, router, onClose],
  )

  const setO = (k: keyof typeof origin) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOrigin((o) => ({ ...o, [k]: e.target.value }))
  const setD = (k: keyof typeof dest) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDest((d) => ({ ...d, [k]: e.target.value }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose()
      }}
    >
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl"
        style={{ colorScheme: 'light' }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Nueva recogida</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Motivo</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as PickupReason)} className={INPUT} disabled={loading}>
              {MANUAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {PICKUP_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recoger en</legend>
            <div className="grid grid-cols-2 gap-3">
              <input className={`${INPUT} col-span-2`} placeholder="Local o cliente" value={origin.name} onChange={setO('name')} disabled={loading} required />
              <input className={INPUT} placeholder="Persona de contacto" value={origin.contact_name} onChange={setO('contact_name')} disabled={loading} />
              <input className={INPUT} placeholder="Teléfono" value={origin.phone} onChange={setO('phone')} disabled={loading} required />
              <input className={`${INPUT} col-span-2`} placeholder="Dirección" value={origin.address} onChange={setO('address')} disabled={loading} required />
              <input className={INPUT} placeholder="Código postal" inputMode="numeric" maxLength={5} value={origin.postal_code} onChange={setO('postal_code')} disabled={loading} required />
              <input className={INPUT} placeholder="Población" value={origin.city} onChange={setO('city')} disabled={loading} required />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Llevar a</legend>
            <div className="flex gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="radio" checked={destType === 'oficina'} onChange={() => setDestType('oficina')} disabled={loading} className="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                Nuestro almacén
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={destType === 'sat'} onChange={() => setDestType('sat')} disabled={loading} className="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                SAT del proveedor
              </label>
            </div>
            {destType === 'sat' && (
              <div className="grid grid-cols-2 gap-3">
                <input className={`${INPUT} col-span-2`} placeholder="Nombre del SAT" value={dest.name} onChange={setD('name')} disabled={loading} required />
                <input className={INPUT} placeholder="Contacto" value={dest.contact_name} onChange={setD('contact_name')} disabled={loading} />
                <input className={INPUT} placeholder="Teléfono" value={dest.phone} onChange={setD('phone')} disabled={loading} />
                <input className={`${INPUT} col-span-2`} placeholder="Dirección" value={dest.address} onChange={setD('address')} disabled={loading} required />
                <input className={INPUT} placeholder="Código postal" inputMode="numeric" maxLength={5} value={dest.postal_code} onChange={setD('postal_code')} disabled={loading} required />
                <input className={INPUT} placeholder="Población" value={dest.city} onChange={setD('city')} disabled={loading} required />
              </div>
            )}
          </fieldset>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Equipos que se recogen (uno por línea)</label>
            <textarea
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
              rows={2}
              className={`${INPUT} resize-none`}
              disabled={loading}
              placeholder={'TPV 15" táctil\nImpresora de tickets'}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Instrucciones para el repartidor (opcional)</label>
            <input className={INPUT} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={200} disabled={loading} placeholder="Ej: Equipo ya embalado" />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear recogida
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
