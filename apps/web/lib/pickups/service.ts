/**
 * Operaciones sobre recogidas que tocan BD + TIPSA + HSM. Solo servidor.
 *
 * Las rutas (/api/pickups/*, /api/external/hsm/pickups/*) y el cron llaman
 * aqui para que la regla de negocio viva en un sitio: que se guarda al
 * programar, cuando se anula en TIPSA, como se recalcula el estado y cuando
 * se avisa a HSM.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { upsertAddressFromOrder } from '@/lib/address-book/upsert'
import {
  cancelPickup as tipsaCancelPickup,
  createPickup as tipsaCreatePickup,
  fetchPickupEvents,
  fetchPickupIncidences,
  fetchPickupInfo,
  fetchTracking,
} from '@/lib/tipsa/client'
import { TIPSA_INCIDENCE_CODE } from '@/lib/tipsa/services'
import type { TipsaConfig, TipsaPickupParty, TipsaShippingEvent } from '@/lib/tipsa/types'
import { derivePickupStatus } from './derive'
import { buildPickupContent, toPickupDTO, type PickupDTO } from './dto'
import { notifyHsm } from './hsm'
import { PICKUP_STATUS_LABELS, TRACKED_PICKUP_STATUSES } from './status'
import type { PickupRequestData, ScheduleData } from './validate'
import type { Pickup, PickupEvent, PickupSource } from '@/types/database'

type Admin = ReturnType<typeof createAdminClient>

export const PICKUP_SELECT = '*'

const ACTIVE_UNIQUE_INDEX = 'pickups_one_active_per_source'

// =========================================================
// Alta
// =========================================================

/**
 * Crea la recogida en estado `solicitada`. Si viene de HSM y ese RMA ya tiene
 * una activa, devuelve la existente con created=false (idempotencia del
 * contrato: un doble clic en HSM no duplica).
 */
export async function insertPickupRequest(
  admin: Admin,
  data: PickupRequestData,
  source: PickupSource,
  createdBy: string | null,
): Promise<{ pickup: Pickup; created: boolean }> {
  const row = {
    source,
    source_id: source === 'hsm' ? data.rma_id : null,
    source_ref: data.rma_number,
    requested_by_name: data.requested_by.name,
    requested_by_email: data.requested_by.email,
    reason: data.reason,
    status: 'solicitada',
    origin_name: data.origin.name,
    origin_contact: data.origin.contact_name,
    origin_phone: data.origin.phone,
    origin_email: data.origin.email,
    origin_address: data.origin.address,
    origin_cp: data.origin.postal_code,
    origin_city: data.origin.city,
    origin_province: data.origin.province,
    destination_type: data.destination.type,
    destination_name: data.destination.name,
    destination_contact: data.destination.contact_name,
    destination_phone: data.destination.phone,
    destination_address: data.destination.address,
    destination_cp: data.destination.postal_code,
    destination_city: data.destination.city,
    items: data.items,
    instructions: data.instructions,
    packages: data.packages,
    weight_kg: data.weight_kg,
    created_by: createdBy,
    // Nace sabida por HSM: es HSM quien la pide y recibe la respuesta.
    hsm_notified_status: source === 'hsm' ? 'solicitada' : null,
  }

  const { data: created, error } = await admin.from('pickups').insert(row).select(PICKUP_SELECT).single()

  if (error) {
    if (error.code === '23505' && error.message.includes(ACTIVE_UNIQUE_INDEX) && data.rma_id) {
      const { data: existing } = await admin
        .from('pickups')
        .select(PICKUP_SELECT)
        .eq('source', source)
        .eq('source_id', data.rma_id)
        .neq('status', 'anulada')
        .maybeSingle()
      if (existing) return { pickup: existing as Pickup, created: false }
    }
    throw new Error(`No se pudo crear la recogida: ${error.message}`)
  }

  const pickup = created as Pickup
  await recordAppEvent(admin, pickup.id, 'solicitada', describeRequest(pickup), createdBy)
  await saveToAddressBook(admin, pickup, createdBy)
  return { pickup, created: true }
}

/**
 * El cliente (y el SAT, si lo hay) pasan a la agenda, como hacen los envios
 * libres: la siguiente recogida o envio a ese local se carga con un clic.
 * upsertAddressFromOrder no lanza y descarta los duplicados.
 */
async function saveToAddressBook(admin: Admin, p: Pickup, createdBy: string | null): Promise<void> {
  const writes = [
    upsertAddressFromOrder(admin, {
      name: p.origin_name,
      address: p.origin_address,
      cp: p.origin_cp,
      city: p.origin_city,
      province: p.origin_province,
      phone: p.origin_phone,
      email: p.origin_email,
      contact_person: p.origin_contact,
      created_by: createdBy,
    }),
  ]
  if (p.destination_type === 'sat' && p.destination_name && p.destination_address && p.destination_cp && p.destination_city) {
    writes.push(
      upsertAddressFromOrder(admin, {
        name: p.destination_name,
        address: p.destination_address,
        cp: p.destination_cp,
        city: p.destination_city,
        phone: p.destination_phone,
        contact_person: p.destination_contact,
        created_by: createdBy,
      }),
    )
  }
  await Promise.all(writes)
}

function describeRequest(p: Pickup): string {
  return p.source === 'hsm'
    ? `Solicitada desde HSM (${p.source_ref})${p.requested_by_name ? ` por ${p.requested_by_name}` : ''}`
    : 'Solicitada en MainOps'
}

// =========================================================
// Programar en TIPSA
// =========================================================

export function pickupDestination(p: Pickup, config: TipsaConfig): TipsaPickupParty {
  if (p.destination_type === 'sat') {
    return {
      name: p.destination_name ?? '',
      address: p.destination_address ?? '',
      city: p.destination_city ?? '',
      cp: p.destination_cp ?? '',
      phone: p.destination_phone ?? config.sender.phone,
      contactPerson: p.destination_contact ?? undefined,
    }
  }
  return { ...config.sender }
}

/** strRef: "RC-202610-0001 RMA-2026-00123" (29 caracteres). */
export function pickupReference(p: Pick<Pickup, 'pickup_id' | 'source_ref'>): string {
  return p.source_ref ? `${p.pickup_id} ${p.source_ref}` : p.pickup_id
}

export async function schedulePickup(
  admin: Admin,
  config: TipsaConfig,
  pickup: Pickup,
  schedule: ScheduleData,
  userId: string | null,
): Promise<Pickup> {
  const destination = pickupDestination(pickup, config)
  const result = await tipsaCreatePickup(config, {
    date: schedule.date,
    timeFrom: schedule.time_from,
    timeTo: schedule.time_to,
    packages: schedule.packages,
    weightKg: schedule.weight_kg,
    serviceCode: schedule.service_code,
    origin: {
      name: pickup.origin_name,
      address: pickup.origin_address,
      city: pickup.origin_city,
      cp: pickup.origin_cp,
      phone: pickup.origin_phone,
      contactPerson: pickup.origin_contact ?? undefined,
    },
    destination,
    reference: pickupReference(pickup),
    observations: schedule.observations ?? pickup.instructions ?? undefined,
    destinationObservations: destination.contactPerson ? `Entregar a ${destination.contactPerson}` : undefined,
    content: buildPickupContent(pickup) || undefined,
  })

  const now = new Date().toISOString()
  const { data: updated, error } = await admin
    .from('pickups')
    .update({
      status: 'programada',
      pickup_date: schedule.date,
      time_from: schedule.time_from,
      time_to: schedule.time_to,
      packages: schedule.packages,
      weight_kg: schedule.weight_kg,
      service_code: schedule.service_code,
      instructions: schedule.observations ?? pickup.instructions,
      tipsa_code: result.code,
      tipsa_guid: result.guid,
      tipsa_origin_agency: result.originAgency,
      tipsa_reserved_albaran: result.reservedAlbaran,
      scheduled_at: now,
      tracking_last_checked_at: now,
    })
    .eq('id', pickup.id)
    .select(PICKUP_SELECT)
    .single()

  // TIPSA ya la tiene: si fallara el update, la recogida existe igual y hay
  // que saberlo para no programarla dos veces.
  if (error || !updated) {
    throw new Error(
      `TIPSA la ha aceptado con el codigo ${result.code}, pero no se pudo guardar: ${error?.message ?? 'sin datos'}`,
    )
  }

  await recordAppEvent(
    admin,
    pickup.id,
    'programada',
    `Programada en TIPSA (${result.code}) para el ${schedule.date}, ${schedule.time_from}–${schedule.time_to}`,
    userId,
    { tipsa: { code: result.code, originAgency: result.originAgency, reservedAlbaran: result.reservedAlbaran } },
  )

  const fresh = updated as Pickup
  await syncPickupWithHsm(admin, fresh)
  return fresh
}

// =========================================================
// Anular
// =========================================================

/**
 * Anula la recogida. Si ya estaba en TIPSA (tiene codigo y aun no se ha
 * recogido) la borra alli primero: si TIPSA no la borra, no la damos por
 * anulada aqui, o el repartidor iria igual.
 */
export async function cancelPickupFlow(
  admin: Admin,
  config: TipsaConfig | null,
  pickup: Pickup,
  reason: string | null,
  userId: string | null,
  by: 'mainops' | 'hsm',
): Promise<Pickup> {
  if (pickup.status === 'anulada') return pickup
  if (pickup.status === 'en_curso' || pickup.status === 'recibida') {
    throw new PickupConflictError('Ya está recogida: no se puede anular.')
  }

  if (pickup.tipsa_code) {
    if (!config) throw new Error('TIPSA no configurada')
    await tipsaCancelPickup(config, pickup.tipsa_code)
  }

  const { data: updated, error } = await admin
    .from('pickups')
    .update({ status: 'anulada', cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq('id', pickup.id)
    .select(PICKUP_SELECT)
    .single()
  if (error || !updated) throw new Error(`No se pudo anular: ${error?.message ?? 'sin datos'}`)

  const who = by === 'hsm' ? 'desde HSM' : 'en MainOps'
  await recordAppEvent(admin, pickup.id, 'anulada', `Anulada ${who}${reason ? `: ${reason}` : ''}`, userId)

  const fresh = updated as Pickup
  // Si la anula HSM, HSM ya lo sabe por la respuesta: no hace falta webhook.
  if (by === 'hsm') {
    await admin.from('pickups').update({ hsm_notified_status: 'anulada', hsm_notified_at: new Date().toISOString() }).eq('id', fresh.id)
    return { ...fresh, hsm_notified_status: 'anulada' }
  }
  await syncPickupWithHsm(admin, fresh)
  return fresh
}

export class PickupConflictError extends Error {}

// =========================================================
// Seguimiento
// =========================================================

/**
 * Pide a TIPSA el estado de una recogida programada, guarda los eventos nuevos
 * y recalcula el estado. Si cambia, avisa a HSM.
 */
export async function refreshPickup(admin: Admin, config: TipsaConfig, pickup: Pickup): Promise<Pickup> {
  if (!pickup.tipsa_code) return pickup

  const pickupEvents = await fetchPickupEvents(config, pickup.tipsa_code)
  await insertTipsaEvents(admin, pickup.id, 'recogida', pickupEvents)

  const info = await fetchPickupInfo(config, pickup.tipsa_code)
  const albaran = info.albaran ?? pickup.albaran

  let shipmentEvents: TipsaShippingEvent[] = []
  if (albaran) {
    shipmentEvents = (await fetchTracking(config, albaran)).events
    await insertTipsaEvents(admin, pickup.id, 'envio', shipmentEvents)
  }

  const status = derivePickupStatus({
    pickupCodes: sortByDate(pickupEvents).map((e) => e.code),
    albaran,
    shipmentCodes: sortByDate(shipmentEvents).map((e) => e.code),
  })

  const now = new Date().toISOString()
  const lastCode = albaran
    ? sortByDate(shipmentEvents).at(-1)?.code
    : sortByDate(pickupEvents).at(-1)?.code
  const updates: Record<string, unknown> = {
    status,
    albaran,
    tracking_last_status: lastCode ?? pickup.tracking_last_status,
    tracking_last_checked_at: now,
  }
  if (albaran && !pickup.picked_up_at) updates.picked_up_at = now
  if (status === 'recibida' && !pickup.received_at) {
    const delivered = shipmentEvents.find((e) => e.code === '3')
    updates.received_at = delivered?.date ?? now
  }

  // La incidencia en detalle (ausente, no tienen mercancia...) solo existe para
  // la recogida; si la incidencia es del envio generado, va sin tipo.
  if (status === 'incidencia' && !albaran && lastCode === TIPSA_INCIDENCE_CODE) {
    const incidences = await fetchPickupIncidences(config, pickup.tipsa_code)
    const open = incidences.filter((i) => !i.resolved)
    const latest = sortByDate(open.length > 0 ? open : incidences).at(-1)
    updates.incidence_code = latest?.code ?? null
    updates.incidence_label = latest?.label ?? null
    updates.incidence_obs = latest?.observations ?? null
  } else if (status !== 'incidencia') {
    updates.incidence_code = null
    updates.incidence_label = null
    updates.incidence_obs = null
  }

  const { data: updated, error } = await admin
    .from('pickups')
    .update(updates)
    .eq('id', pickup.id)
    .select(PICKUP_SELECT)
    .single()
  if (error || !updated) throw new Error(`No se pudo guardar el estado: ${error?.message ?? 'sin datos'}`)

  const fresh = updated as Pickup
  if (fresh.status !== pickup.status) {
    await recordAppEvent(admin, pickup.id, fresh.status, `Estado: ${PICKUP_STATUS_LABELS[fresh.status]}`, null)
  }
  await syncPickupWithHsm(admin, fresh)
  return fresh
}

/**
 * Pasada del cron: refresca todas las recogidas en seguimiento y reintenta
 * los avisos a HSM pendientes. Un fallo en una no para las demas.
 */
export async function refreshTrackedPickups(
  admin: Admin,
  config: TipsaConfig,
): Promise<{ refreshed: number; failed: Array<{ pickup_id: string; error: string }>; hsmRetried: number }> {
  const failed: Array<{ pickup_id: string; error: string }> = []
  let refreshed = 0

  const { data: tracked, error } = await admin
    .from('pickups')
    .select(PICKUP_SELECT)
    .in('status', TRACKED_PICKUP_STATUSES)
    .not('tipsa_code', 'is', null)
    // Van dentro del cron de envios (maxDuration 60 s) y cada una son 3-4
    // llamadas SOAP: 15 por pasada, las menos recientes primero, y rotan.
    .order('tracking_last_checked_at', { ascending: true, nullsFirst: true })
    .limit(15)
  if (error) throw new Error(`pickups read: ${error.message}`)

  for (const p of (tracked ?? []) as Pickup[]) {
    try {
      await refreshPickup(admin, config, p)
      refreshed += 1
    } catch (err) {
      failed.push({ pickup_id: p.pickup_id, error: (err as Error).message })
    }
  }

  // Avisos que HSM no confirmo (caido, 5xx...). Incluye terminales: HSM tiene
  // que acabar sabiendo que se recibio o se anulo. PostgREST no compara dos
  // columnas, asi que se filtra en memoria sobre las movidas mas recientes.
  const { data: pending } = await admin
    .from('pickups')
    .select(PICKUP_SELECT)
    .eq('source', 'hsm')
    .order('updated_at', { ascending: false })
    .limit(200)
  let hsmRetried = 0
  for (const p of ((pending ?? []) as Pickup[]).filter((x) => x.hsm_notified_status !== x.status)) {
    if (await syncPickupWithHsm(admin, p)) hsmRetried += 1
  }

  return { refreshed, failed, hsmRetried }
}

// =========================================================
// HSM
// =========================================================

/**
 * Si la recogida viene de HSM y HSM no tiene su estado actual, se lo manda.
 * Devuelve true si HSM lo ha confirmado ahora.
 */
export async function syncPickupWithHsm(admin: Admin, pickup: Pickup): Promise<boolean> {
  if (pickup.source !== 'hsm' || pickup.hsm_notified_status === pickup.status) return false

  const result = await notifyHsm(await buildDTO(admin, pickup))
  if (!result.ok) {
    console.error(`[pickups] aviso a HSM de ${pickup.pickup_id} fallido: ${result.reason}`)
    return false
  }
  await admin
    .from('pickups')
    .update({ hsm_notified_status: pickup.status, hsm_notified_at: new Date().toISOString() })
    .eq('id', pickup.id)
  return true
}

export async function buildDTO(admin: Admin, pickup: Pickup): Promise<PickupDTO> {
  const { data: last } = await admin
    .from('pickup_events')
    .select('event_code, event_label, event_date')
    .eq('pickup_id', pickup.id)
    .in('kind', ['recogida', 'envio'])
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return toPickupDTO(pickup, (last as Pick<PickupEvent, 'event_code' | 'event_label' | 'event_date'> | null) ?? null)
}

// =========================================================
// Eventos
// =========================================================

export async function recordAppEvent(
  admin: Admin,
  pickupId: string,
  code: string,
  label: string,
  userId: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('pickup_events').insert({
    pickup_id: pickupId,
    kind: 'app',
    event_code: code,
    event_label: label,
    event_date: new Date().toISOString(),
    created_by: userId,
    raw_payload: payload ?? null,
  })
  if (error) console.error(`[pickups] evento ${code}:`, error.message)
}

async function insertTipsaEvents(
  admin: Admin,
  pickupId: string,
  kind: 'recogida' | 'envio',
  events: TipsaShippingEvent[],
): Promise<void> {
  // El UNIQUE parcial (pickup_id, kind, event_code, event_date) hace de dedupe:
  // 23505 = ya lo teniamos. Uno a uno, como en el cron de envios.
  for (const ev of events) {
    const { error } = await admin.from('pickup_events').insert({
      pickup_id: pickupId,
      kind,
      event_code: ev.code,
      event_label: ev.label,
      event_date: ev.date,
      raw_payload: ev.rawAttributes,
    })
    if (error && error.code !== '23505') {
      console.error(`[pickups] evento ${kind} ${ev.code}:`, error.message)
    }
  }
}

function sortByDate<T extends { date: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date))
}
