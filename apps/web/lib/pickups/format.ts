/**
 * Textos de recogidas para la UI. Sin dependencias de servidor: lo usan
 * componentes cliente y paginas server por igual.
 */
import { PICKUP_STATUS_LABELS, shortTime } from './status'
import type { Pickup } from '@/types/database'

/** "lun 26/10" a partir de YYYY-MM-DD, sin desfase de zona horaria. */
export function formatPickupDay(date: string | null): string | null {
  if (!date) return null
  const d = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })
    .format(d)
    .replace(',', '')
}

/** "lun 26/10 · 09:00–14:00", o null si aun no se ha programado. */
export function formatPickupWindow(p: Pick<Pickup, 'pickup_date' | 'time_from' | 'time_to'>): string | null {
  const day = formatPickupDay(p.pickup_date)
  if (!day) return null
  const from = shortTime(p.time_from)
  const to = shortTime(p.time_to)
  return from && to ? `${day} · ${from}–${to}` : day
}

/** Etiqueta del badge: añade el tipo de incidencia cuando lo hay. */
export function pickupBadgeLabel(p: Pick<Pickup, 'status' | 'incidence_label'>): string {
  if (p.status === 'incidencia' && p.incidence_label) return `Incidencia · ${p.incidence_label}`
  return PICKUP_STATUS_LABELS[p.status]
}

/** "Oficina (Sevilla)" o "SAT 10POS · Barcelona". */
export function pickupDestinationLabel(p: Pick<Pickup, 'destination_type' | 'destination_name' | 'destination_city'>): string {
  if (p.destination_type === 'sat') {
    return [p.destination_name ?? 'SAT del proveedor', p.destination_city].filter(Boolean).join(' · ')
  }
  return 'Nuestro almacén'
}

/**
 * Siguiente dia de lunes a viernes a partir de hoy, YYYY-MM-DD. Es solo el
 * valor por defecto del formulario: GrabaRecogida va con boSabado=false.
 */
export function nextWorkingDay(today: string): string {
  const d = new Date(`${today}T12:00:00Z`)
  do {
    d.setUTCDate(d.getUTCDate() + 1)
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}
