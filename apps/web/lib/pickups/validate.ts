// =============================================================
// Validacion de payloads de recogidas
//   * validatePickupRequest: POST /api/external/hsm/pickups (contrato con HSM)
//     y POST /api/pickups (alta manual). Misma forma en los dos.
//   * validateScheduleBody: POST /api/pickups/[id]/schedule
// Contrato: docs/integrations/hsm/RECOGIDAS-CONTRATO.md
// =============================================================

import type { PickupDestinationType, PickupItem, PickupReason } from '@/types/database'

const CP_REGEX = /^\d{5}$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/
const REASONS: PickupReason[] = ['rma', 'devolucion', 'baja', 'cambio', 'otro']

export type FieldValidation<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; field: string }

export interface PickupRequestData {
  rma_id: string | null
  rma_number: string | null
  reason: PickupReason
  requested_by: { name: string | null; email: string | null }
  origin: {
    name: string
    contact_name: string | null
    phone: string
    email: string | null
    address: string
    postal_code: string
    city: string
    province: string | null
  }
  destination: {
    type: PickupDestinationType
    name: string | null
    contact_name: string | null
    phone: string | null
    address: string | null
    postal_code: string | null
    city: string | null
  }
  items: PickupItem[]
  instructions: string | null
  packages: number
  weight_kg: number
  /** Franja que le viene bien al cliente (HH:MM). Logistica la usa al programar. */
  time_from: string | null
  time_to: string | null
}

export interface ScheduleData {
  date: string
  time_from: string
  time_to: string
  packages: number
  weight_kg: number
  service_code: string
  observations: string | null
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Telefono espanol o internacional: 9 a 15 digitos, admite +, espacios y guiones. */
function isPhone(v: string): boolean {
  const digits = v.replace(/[\s\-+()]/g, '')
  return /^\d{9,15}$/.test(digits)
}

function fail<T>(field: string, error: string): FieldValidation<T> {
  return { ok: false, field, error }
}

function positiveInt(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null
}

function positiveWeight(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 1000) / 1000 : null
}

export function validatePickupRequest(
  raw: unknown,
  opts: { requireRma: boolean },
): FieldValidation<PickupRequestData> {
  const body = asObject(raw)
  if (!body) return fail('body', 'El cuerpo debe ser un objeto JSON.')

  const rmaId = trimOrNull(body.rma_id)
  const rmaNumber = trimOrNull(body.rma_number)
  if (opts.requireRma) {
    if (!rmaId) return fail('rma_id', 'rma_id es obligatorio.')
    if (!rmaNumber) return fail('rma_number', 'rma_number es obligatorio.')
  }

  const reasonRaw = trimOrNull(body.reason) ?? (opts.requireRma ? 'rma' : null)
  if (!reasonRaw || !REASONS.includes(reasonRaw as PickupReason)) {
    return fail('reason', `reason debe ser uno de: ${REASONS.join(', ')}.`)
  }

  const o = asObject(body.origin)
  if (!o) return fail('origin', 'origin es obligatorio.')
  const originName = trimOrEmpty(o.name)
  if (!originName) return fail('origin.name', 'Falta el nombre del cliente o local.')
  const originAddress = trimOrEmpty(o.address)
  if (!originAddress) return fail('origin.address', 'Falta la dirección de recogida.')
  const originCp = trimOrEmpty(o.postal_code)
  if (!CP_REGEX.test(originCp)) return fail('origin.postal_code', 'El código postal de recogida debe tener 5 dígitos.')
  const originCity = trimOrEmpty(o.city)
  if (!originCity) return fail('origin.city', 'Falta la población de recogida.')
  const originPhone = trimOrEmpty(o.phone)
  if (!isPhone(originPhone)) return fail('origin.phone', 'Falta un teléfono válido en la recogida: TIPSA lo exige.')

  const d = asObject(body.destination)
  if (!d) return fail('destination', 'destination es obligatorio.')
  const destType = trimOrEmpty(d.type)
  if (destType === 'cliente') {
    return fail('destination.type', 'Una recogida va a nuestra oficina o al SAT del proveedor, no al cliente.')
  }
  if (destType !== 'oficina' && destType !== 'sat') {
    return fail('destination.type', 'destination.type debe ser oficina o sat.')
  }

  let destination: PickupRequestData['destination'] = {
    type: destType,
    name: null,
    contact_name: null,
    phone: null,
    address: null,
    postal_code: null,
    city: null,
  }
  if (destType === 'sat') {
    const name = trimOrEmpty(d.name)
    if (!name) return fail('destination.name', 'Falta el nombre del SAT.')
    const address = trimOrEmpty(d.address)
    if (!address) return fail('destination.address', 'Falta la dirección del SAT.')
    const cp = trimOrEmpty(d.postal_code)
    if (!CP_REGEX.test(cp)) return fail('destination.postal_code', 'El código postal del SAT debe tener 5 dígitos.')
    const city = trimOrEmpty(d.city)
    if (!city) return fail('destination.city', 'Falta la población del SAT.')
    const phone = trimOrNull(d.phone)
    if (phone && !isPhone(phone)) return fail('destination.phone', 'El teléfono del SAT no es válido.')
    destination = {
      type: 'sat',
      name,
      contact_name: trimOrNull(d.contact_name),
      phone,
      address,
      postal_code: cp,
      city,
    }
  }

  const items: PickupItem[] = []
  if (body.items !== undefined && body.items !== null) {
    if (!Array.isArray(body.items)) return fail('items', 'items debe ser una lista.')
    for (const [i, it] of body.items.entries()) {
      const obj = asObject(it)
      const description = obj ? trimOrEmpty(obj.description) : ''
      if (!description) return fail(`items[${i}].description`, 'Cada equipo necesita una descripción.')
      items.push({ description, serial: obj ? trimOrNull(obj.serial) : null })
    }
  }

  const packages = positiveInt(body.packages, 1)
  if (packages === null) return fail('packages', 'packages debe ser un entero entre 1 y 99.')
  const weight = positiveWeight(body.weight_kg, 1)
  if (weight === null) return fail('weight_kg', 'weight_kg debe ser un número mayor que 0.')

  // Horario del cliente: opcional, pero si viene, las dos horas y con sentido.
  const timeFrom = trimOrNull(body.time_from)
  const timeTo = trimOrNull(body.time_to)
  if (timeFrom || timeTo) {
    if (!timeFrom || !TIME_REGEX.test(timeFrom)) return fail('time_from', 'Hora de inicio del cliente no válida (HH:MM).')
    if (!timeTo || !TIME_REGEX.test(timeTo)) return fail('time_to', 'Hora de fin del cliente no válida (HH:MM).')
    if (timeFrom >= timeTo) return fail('time_to', 'El horario del cliente tiene que terminar después de empezar.')
  }

  const requestedBy = asObject(body.requested_by)

  return {
    ok: true,
    data: {
      rma_id: rmaId,
      rma_number: rmaNumber,
      reason: reasonRaw as PickupReason,
      requested_by: {
        name: requestedBy ? trimOrNull(requestedBy.name) : null,
        email: requestedBy ? trimOrNull(requestedBy.email) : null,
      },
      origin: {
        name: originName,
        contact_name: trimOrNull(o.contact_name),
        phone: originPhone,
        email: trimOrNull(o.email),
        address: originAddress,
        postal_code: originCp,
        city: originCity,
        province: trimOrNull(o.province),
      },
      destination,
      items,
      instructions: trimOrNull(body.instructions),
      packages,
      weight_kg: weight,
      time_from: timeFrom,
      time_to: timeTo,
    },
  }
}

/**
 * @param today YYYY-MM-DD de hoy en Madrid. Se inyecta para poder testear.
 */
export function validateScheduleBody(raw: unknown, today: string): FieldValidation<ScheduleData> {
  const body = asObject(raw)
  if (!body) return fail('body', 'El cuerpo debe ser un objeto JSON.')

  const date = trimOrEmpty(body.date)
  if (!DATE_REGEX.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    return fail('date', 'Fecha no válida.')
  }
  if (date < today) return fail('date', 'La fecha de recogida no puede ser anterior a hoy.')
  // Domingo: TIPSA no recoge. El sabado lo decide TIPSA segun zona (boSabado va a false).
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) {
    return fail('date', 'TIPSA no recoge en domingo.')
  }

  const from = trimOrEmpty(body.time_from)
  const to = trimOrEmpty(body.time_to)
  if (!TIME_REGEX.test(from)) return fail('time_from', 'Hora de inicio no válida (HH:MM).')
  if (!TIME_REGEX.test(to)) return fail('time_to', 'Hora de fin no válida (HH:MM).')
  if (from >= to) return fail('time_to', 'La franja tiene que terminar después de empezar.')

  const packages = positiveInt(body.packages, 1)
  if (packages === null) return fail('packages', 'Los bultos deben ser un entero entre 1 y 99.')
  const weight = positiveWeight(body.weight_kg, 1)
  if (weight === null) return fail('weight_kg', 'El peso debe ser mayor que 0.')

  const serviceCode = trimOrEmpty(body.service_code)
  if (!serviceCode) return fail('service_code', 'Elige el servicio de TIPSA.')

  return {
    ok: true,
    data: {
      date,
      time_from: from,
      time_to: to,
      packages,
      weight_kg: weight,
      service_code: serviceCode,
      observations: trimOrNull(body.observations),
    },
  }
}

/** YYYY-MM-DD de hoy en Europe/Madrid. */
export function todayInMadrid(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
