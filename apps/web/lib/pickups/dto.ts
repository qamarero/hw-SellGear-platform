/**
 * PickupDTO: la forma en que MainOps cuenta una recogida a HSM, tanto en las
 * respuestas de /api/external/hsm/pickups como en el webhook.
 * Contrato: docs/integrations/hsm/RECOGIDAS-CONTRATO.md (seccion PickupDTO).
 */
import { PICKUP_STATUS_LABELS, shortTime } from './status'
import type { Pickup, PickupEvent, PickupStatus } from '@/types/database'

export interface PickupDTO {
  pickup_id: string
  rma_id: string | null
  rma_number: string | null
  status: PickupStatus
  status_label: string
  pickup_date: string | null
  time_from: string | null
  time_to: string | null
  tipsa_code: string | null
  albaran: string | null
  incidence: { code: string; label: string; observations: string | null } | null
  last_event: { code: string; label: string; date: string } | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
}

/**
 * @param lastEvent ultimo evento de TIPSA (recogida o envio), si se tiene a mano.
 */
export function toPickupDTO(p: Pickup, lastEvent?: Pick<PickupEvent, 'event_code' | 'event_label' | 'event_date'> | null): PickupDTO {
  return {
    pickup_id: p.pickup_id,
    rma_id: p.source === 'hsm' ? p.source_id : null,
    rma_number: p.source === 'hsm' ? p.source_ref : null,
    status: p.status,
    status_label: PICKUP_STATUS_LABELS[p.status],
    pickup_date: p.pickup_date,
    time_from: shortTime(p.time_from),
    time_to: shortTime(p.time_to),
    tipsa_code: p.tipsa_code,
    albaran: p.albaran,
    incidence:
      p.status === 'incidencia' && p.incidence_code
        ? { code: p.incidence_code, label: p.incidence_label ?? p.incidence_code, observations: p.incidence_obs }
        : null,
    last_event: lastEvent
      ? { code: lastEvent.event_code, label: lastEvent.event_label ?? `Estado ${lastEvent.event_code}`, date: lastEvent.event_date }
      : null,
    cancel_reason: p.cancel_reason,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

/** Texto para strContenido de TIPSA: "10POS 10D-21 (SN 123) + Impresora". */
export function buildPickupContent(p: Pick<Pickup, 'items'>): string {
  return (p.items ?? [])
    .map((it) => (it.serial ? `${it.description} (SN ${it.serial})` : it.description))
    .join(' + ')
    .slice(0, 200)
}
