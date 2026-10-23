'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { USUAL_PICKUP_WINDOW, isUnusualPickupWindow, pickupDestinationLabel } from '@/lib/pickups/format'
import { shortTime } from '@/lib/pickups/status'
import type { Pickup } from '@/types/database'

interface ServiceOption {
  code: string
  label: string
}

interface SchedulePickupModalProps {
  pickup: Pickup
  services: ServiceOption[]
  defaultServiceCode: string
  /** Primer dia propuesto (YYYY-MM-DD) y minimo seleccionable. */
  defaultDate: string
  minDate: string
  onClose: () => void
}

const INPUT =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

/**
 * Programar en TIPSA una recogida solicitada. Origen y destino vienen de la
 * solicitud (HSM o alta manual) y se muestran solo para revisar: si algo esta
 * mal, se anula y se pide otra con los datos buenos.
 */
export default function SchedulePickupModal({
  pickup,
  services,
  defaultServiceCode,
  defaultDate,
  minDate,
  onClose,
}: SchedulePickupModalProps) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  // Parte de la franja que pidio el cliente (HSM o alta manual), si la hay.
  const clientFrom = shortTime(pickup.time_from)
  const clientTo = shortTime(pickup.time_to)
  const [timeFrom, setTimeFrom] = useState(clientFrom ?? '09:00')
  const [timeTo, setTimeTo] = useState(clientTo ?? '14:00')
  const [packages, setPackages] = useState(pickup.packages)
  const [weightKg, setWeightKg] = useState(Number(pickup.weight_kg))
  const [serviceCode, setServiceCode] = useState(
    services.some((s) => s.code === defaultServiceCode) ? defaultServiceCode : services[0]?.code ?? '48',
  )
  const [observations, setObservations] = useState(pickup.instructions ?? '')
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
        const res = await fetch(`/api/pickups/${pickup.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            time_from: timeFrom,
            time_to: timeTo,
            packages,
            weight_kg: weightKg,
            service_code: serviceCode,
            observations: observations.trim() || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Error programando la recogida')
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
    [pickup.id, date, timeFrom, timeTo, packages, weightKg, serviceCode, observations, router, onClose],
  )

  const items = pickup.items ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose()
      }}
    >
      <div className="relative mx-4 w-full max-w-lg rounded-xl bg-white shadow-2xl" style={{ colorScheme: 'light' }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Programar recogida · <span className="font-mono">{pickup.source_ref ?? pickup.pickup_id}</span>
          </h3>
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
          <div className="rounded-md border border-gray-300 bg-gray-50 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Recoger en → llevar a
            </p>
            <div className="space-y-1 text-xs text-gray-800">
              <p className="font-semibold text-gray-900">{pickup.origin_name}</p>
              <p>
                {pickup.origin_address}, {pickup.origin_cp} {pickup.origin_city}
              </p>
              <p className="text-gray-500">
                {[pickup.origin_contact, pickup.origin_phone].filter(Boolean).join(' · ')}
              </p>
              <p className="pt-1">
                <span className="text-gray-500">Destino:</span> {pickupDestinationLabel(pickup)}
              </p>
              {items.length > 0 && (
                <p>
                  <span className="text-gray-500">Equipos:</span>{' '}
                  {items.map((it) => it.description).join(', ')}
                </p>
              )}
              {clientFrom && clientTo && (
                <p>
                  <span className="text-gray-500">Horario del cliente:</span> {clientFrom}–{clientTo}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} disabled={loading} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Desde</label>
              <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className={INPUT} disabled={loading} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Hasta</label>
              <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className={INPUT} disabled={loading} required />
            </div>
          </div>

          {isUnusualPickupWindow(timeFrom, timeTo) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Horario extraordinario (fuera de {USUAL_PICKUP_WINDOW.from}–{USUAL_PICKUP_WINDOW.to}): confírmalo con la
              agencia de origen de TIPSA antes de programar.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Bultos</label>
              <input
                type="number"
                min={1}
                step={1}
                value={packages}
                onChange={(e) => setPackages(Math.max(1, Number(e.target.value)))}
                className={INPUT}
                disabled={loading}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Peso (kg)</label>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={weightKg}
                onChange={(e) => setWeightKg(Math.max(0.1, Number(e.target.value)))}
                className={INPUT}
                disabled={loading}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Servicio</label>
              <select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} className={INPUT} disabled={loading}>
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label} ({s.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="-mt-2 text-[11px] text-gray-500">
            El servicio decide el plazo del envío que TIPSA genera al recoger: con «14 Horas» llega en 14 h.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Instrucciones para el repartidor (opcional)</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              maxLength={200}
              className={`${INPUT} resize-none placeholder:text-gray-400`}
              disabled={loading}
              placeholder="Ej: Preguntar por el encargado"
            />
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
              Pedir recogida a TIPSA
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
