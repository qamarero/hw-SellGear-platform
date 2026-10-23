'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import SchedulePickupModal from './SchedulePickupModal'
import type { Pickup } from '@/types/database'

interface PickupActionsProps {
  pickup: Pickup
  services: Array<{ code: string; label: string }>
  defaultServiceCode: string
  defaultDate: string
  minDate: string
}

const SECONDARY =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export default function PickupActions({ pickup, services, defaultServiceCode, defaultDate, minDate }: PickupActionsProps) {
  const router = useRouter()
  const [scheduling, setScheduling] = useState(false)
  const [busy, setBusy] = useState<'refresh' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canSchedule = pickup.status === 'solicitada'
  const canRefresh = !!pickup.tipsa_code && ['programada', 'incidencia', 'en_curso'].includes(pickup.status)
  const canCancel = ['solicitada', 'programada', 'incidencia'].includes(pickup.status)

  async function post(path: string, body?: unknown): Promise<boolean> {
    setError(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Error')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.')
      return false
    }
  }

  async function handleRefresh() {
    setBusy('refresh')
    await post(`/api/pickups/${pickup.id}/refresh`)
    setBusy(null)
  }

  async function handleCancel() {
    const warning = pickup.tipsa_code
      ? `Se anulará también en TIPSA (${pickup.tipsa_code}). Si la agencia de origen ya la ha leído, TIPSA no lo permitirá y habrá que llamar a la agencia.`
      : 'Aún no está en TIPSA.'
    if (!window.confirm(`¿Anular la recogida ${pickup.pickup_id}? ${warning}`)) return
    const reason = window.prompt('Motivo (opcional, lo verá HSM):') ?? ''
    setBusy('cancel')
    await post(`/api/pickups/${pickup.id}/cancel`, { reason: reason.trim() || undefined })
    setBusy(null)
  }

  if (!canSchedule && !canRefresh && !canCancel) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canSchedule && (
          <button
            type="button"
            onClick={() => setScheduling(true)}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            Programar en TIPSA
          </button>
        )}
        {canRefresh && (
          <button type="button" onClick={handleRefresh} disabled={busy !== null} className={SECONDARY}>
            {busy === 'refresh' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Actualizar
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === 'cancel' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Anular
          </button>
        )}
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {scheduling && (
        <SchedulePickupModal
          pickup={pickup}
          services={services}
          defaultServiceCode={defaultServiceCode}
          defaultDate={defaultDate}
          minDate={minDate}
          onClose={() => setScheduling(false)}
        />
      )}
    </div>
  )
}
