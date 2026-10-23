/**
 * Estados de una recogida: etiquetas, colores y que estados sigue el cron.
 *
 * Sin imports de lib/tipsa/services: este fichero viaja al bundle de cliente
 * (badges, filtros) y services lee process.env. La logica que decide el
 * estado a partir de TIPSA vive en ./derive.ts, solo servidor.
 */
import type { PickupReason, PickupStatus } from '@/types/database'

export const PICKUP_STATUS_LABELS: Record<PickupStatus, string> = {
  solicitada: 'Solicitada',
  programada: 'Programada',
  incidencia: 'Incidencia',
  en_curso:   'Recogida · en camino',
  recibida:   'Recibida',
  anulada:    'Anulada',
}

// Mismo lenguaje que SHIPMENT_STATUS_COLORS (lib/utils.ts): gris lo que espera,
// azul lo que se mueve, rojo la incidencia, verde con anillo lo terminado.
// Solicitada en morado: es lo unico que pide accion a logistica.
export const PICKUP_STATUS_COLORS: Record<PickupStatus, string> = {
  solicitada: 'bg-purple-100 text-purple-800',
  programada: 'bg-gray-100 text-gray-800',
  incidencia: 'bg-red-100 text-red-800',
  en_curso:   'bg-blue-100 text-blue-800',
  recibida:   'bg-green-50 text-green-700 ring-2 ring-green-500 font-semibold',
  anulada:    'bg-gray-200 text-gray-700 line-through',
}

/** Los que el cron consulta a TIPSA: ya dados de alta y sin cerrar. */
export const TRACKED_PICKUP_STATUSES: PickupStatus[] = ['programada', 'incidencia', 'en_curso']

export const TERMINAL_PICKUP_STATUSES: PickupStatus[] = ['recibida', 'anulada']

export const PICKUP_REASON_LABELS: Record<PickupReason, string> = {
  rma:        'RMA',
  devolucion: 'Devolución',
  baja:       'Baja',
  cambio:     'Cambio de equipo',
  otro:       'Otro',
}

/** "09:00:00" (columna TIME) o "09:00" -> "09:00". */
export function shortTime(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : null
}
