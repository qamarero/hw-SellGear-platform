/**
 * Logica de recogidas: validacion del contrato con HSM, estado a partir de
 * TIPSA y forma del DTO que se manda a HSM.
 */

import { describe, expect, it } from 'vitest'
import { derivePickupStatus } from '@/lib/pickups/derive'
import { buildPickupContent, toPickupDTO } from '@/lib/pickups/dto'
import { pickupReference } from '@/lib/pickups/service'
import { shortTime } from '@/lib/pickups/status'
import { todayInMadrid, validatePickupRequest, validateScheduleBody } from '@/lib/pickups/validate'
import type { Pickup } from '@/types/database'

const HSM_BODY = {
  rma_id: '8f0c2b0e-0000-4000-8000-000000000001',
  rma_number: 'RMA-2026-00123',
  requested_by: { name: 'Ana', email: 'ana@qamarero.com' },
  origin: {
    name: 'Bar La Esquina',
    contact_name: 'Laura',
    phone: '600 000 000',
    address: 'C/ Ejemplo 12',
    postal_code: '28004',
    city: 'Madrid',
  },
  destination: { type: 'oficina' },
  items: [{ description: '10POS 10D-21 J6412', serial: '10D21-2405-01187' }],
  instructions: 'Preguntar por el encargado',
}

describe('validatePickupRequest', () => {
  it('acepta el ejemplo del contrato con valores por defecto', () => {
    const r = validatePickupRequest(HSM_BODY, { requireRma: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reason).toBe('rma')
    expect(r.data.packages).toBe(1)
    expect(r.data.weight_kg).toBe(1)
    expect(r.data.destination).toMatchObject({ type: 'oficina', address: null })
    expect(r.data.items).toEqual([{ description: '10POS 10D-21 J6412', serial: '10D21-2405-01187' }])
  })

  it('desde HSM el RMA es obligatorio', () => {
    const r = validatePickupRequest({ ...HSM_BODY, rma_id: '' }, { requireRma: true })
    expect(r).toMatchObject({ ok: false, field: 'rma_id' })
  })

  it('el alta manual no necesita RMA pero si motivo', () => {
    const manual = { ...HSM_BODY, rma_id: undefined, rma_number: undefined }
    expect(validatePickupRequest(manual, { requireRma: false })).toMatchObject({ ok: false, field: 'reason' })
    expect(validatePickupRequest({ ...manual, reason: 'baja' }, { requireRma: false }).ok).toBe(true)
  })

  it('senala el campo que falla', () => {
    const r = validatePickupRequest(
      { ...HSM_BODY, origin: { ...HSM_BODY.origin, postal_code: '2800' } },
      { requireRma: true },
    )
    expect(r).toMatchObject({ ok: false, field: 'origin.postal_code' })
  })

  it('TIPSA exige telefono en origen', () => {
    const r = validatePickupRequest(
      { ...HSM_BODY, origin: { ...HSM_BODY.origin, phone: '123' } },
      { requireRma: true },
    )
    expect(r).toMatchObject({ ok: false, field: 'origin.phone' })
  })

  it('un envio directo al cliente no es una recogida', () => {
    const r = validatePickupRequest({ ...HSM_BODY, destination: { type: 'cliente' } }, { requireRma: true })
    expect(r).toMatchObject({ ok: false, field: 'destination.type' })
  })

  it('al SAT hace falta su direccion', () => {
    const sat = { type: 'sat', name: 'SAT 10POS', address: 'Nave 3', postal_code: '08040' }
    expect(validatePickupRequest({ ...HSM_BODY, destination: sat }, { requireRma: true })).toMatchObject({
      ok: false,
      field: 'destination.city',
    })
    const ok = validatePickupRequest(
      { ...HSM_BODY, destination: { ...sat, city: 'Barcelona' } },
      { requireRma: true },
    )
    expect(ok.ok).toBe(true)
  })
})

describe('validateScheduleBody', () => {
  const base = {
    date: '2026-10-26',
    time_from: '09:00',
    time_to: '14:00',
    packages: '2',
    weight_kg: '3.5',
    service_code: '48',
  }

  it('acepta una franja valida y normaliza numeros', () => {
    const r = validateScheduleBody(base, '2026-10-23')
    expect(r).toMatchObject({ ok: true, data: { packages: 2, weight_kg: 3.5, observations: null } })
  })

  it('no deja programar en el pasado ni en domingo', () => {
    expect(validateScheduleBody(base, '2026-10-27')).toMatchObject({ ok: false, field: 'date' })
    expect(validateScheduleBody({ ...base, date: '2026-10-25' }, '2026-10-23')).toMatchObject({
      ok: false,
      error: 'TIPSA no recoge en domingo.',
    })
  })

  it('la franja tiene que tener sentido', () => {
    expect(validateScheduleBody({ ...base, time_to: '09:00' }, '2026-10-23')).toMatchObject({
      ok: false,
      field: 'time_to',
    })
    expect(validateScheduleBody({ ...base, time_from: '9:00' }, '2026-10-23')).toMatchObject({
      ok: false,
      field: 'time_from',
    })
  })
})

describe('todayInMadrid', () => {
  it('usa la fecha de Madrid, no la UTC', () => {
    // 23:30 UTC del 23/10 ya es 24/10 en Madrid (CEST)
    expect(todayInMadrid(new Date('2026-10-23T23:30:00Z'))).toBe('2026-10-24')
  })
})

describe('derivePickupStatus', () => {
  it('sin albaran: programada, o incidencia si el ultimo estado es 4', () => {
    expect(derivePickupStatus({ pickupCodes: [], albaran: null, shipmentCodes: [] })).toBe('programada')
    expect(derivePickupStatus({ pickupCodes: ['0', '12', '4'], albaran: null, shipmentCodes: [] })).toBe('incidencia')
    expect(derivePickupStatus({ pickupCodes: ['4', '12'], albaran: null, shipmentCodes: [] })).toBe('programada')
  })

  it('los codigos 11-14 solos no dan la recogida por hecha', () => {
    expect(derivePickupStatus({ pickupCodes: ['0', '11', '13'], albaran: null, shipmentCodes: [] })).toBe('programada')
  })

  it('con albaran: en camino, incidencia o recibida segun el envio', () => {
    expect(derivePickupStatus({ pickupCodes: ['4'], albaran: '0000012890', shipmentCodes: ['0', '1'] })).toBe('en_curso')
    expect(derivePickupStatus({ pickupCodes: [], albaran: '0000012890', shipmentCodes: ['1', '4'] })).toBe('incidencia')
    expect(derivePickupStatus({ pickupCodes: [], albaran: '0000012890', shipmentCodes: ['2', '3', '14'] })).toBe('recibida')
  })
})

function pickup(overrides: Partial<Pickup> = {}): Pickup {
  return {
    id: 'uuid-1',
    pickup_id: 'RC-202610-0001',
    created_at: '2026-10-23T15:00:00.000Z',
    updated_at: '2026-10-23T16:00:00.000Z',
    created_by: null,
    source: 'hsm',
    source_id: 'rma-uuid',
    source_ref: 'RMA-2026-00123',
    requested_by_name: null,
    requested_by_email: null,
    reason: 'rma',
    status: 'programada',
    origin_name: 'Bar La Esquina',
    origin_contact: null,
    origin_phone: '600000000',
    origin_email: null,
    origin_address: 'C/ Ejemplo 12',
    origin_cp: '28004',
    origin_city: 'Madrid',
    origin_province: null,
    destination_type: 'oficina',
    destination_name: null,
    destination_contact: null,
    destination_phone: null,
    destination_address: null,
    destination_cp: null,
    destination_city: null,
    items: [{ description: 'TPV', serial: 'SN1' }, { description: 'Impresora' }],
    instructions: null,
    packages: 1,
    weight_kg: 1,
    pickup_date: '2026-10-26',
    time_from: '09:00:00',
    time_to: '14:00:00',
    service_code: '48',
    tipsa_code: '0028850418',
    tipsa_guid: null,
    tipsa_origin_agency: null,
    tipsa_reserved_albaran: null,
    albaran: null,
    tracking_last_status: null,
    tracking_last_checked_at: null,
    incidence_code: 'AS',
    incidence_label: 'Ausente',
    incidence_obs: null,
    scheduled_at: null,
    picked_up_at: null,
    received_at: null,
    cancelled_at: null,
    cancel_reason: null,
    hsm_notified_status: null,
    hsm_notified_at: null,
    notes: null,
    ...overrides,
  }
}

describe('toPickupDTO', () => {
  it('da la forma del contrato con horas cortas', () => {
    const dto = toPickupDTO(pickup(), { event_code: '12', event_label: 'Leída repartidor', event_date: '2026-10-26T06:12:00.000Z' })
    expect(dto).toMatchObject({
      pickup_id: 'RC-202610-0001',
      rma_id: 'rma-uuid',
      rma_number: 'RMA-2026-00123',
      status: 'programada',
      status_label: 'Programada',
      time_from: '09:00',
      time_to: '14:00',
      tipsa_code: '0028850418',
      last_event: { code: '12', label: 'Leída repartidor' },
    })
  })

  it('la incidencia solo viaja cuando el estado es incidencia', () => {
    expect(toPickupDTO(pickup()).incidence).toBeNull()
    expect(toPickupDTO(pickup({ status: 'incidencia' })).incidence).toEqual({
      code: 'AS',
      label: 'Ausente',
      observations: null,
    })
  })

  it('una recogida manual no expone ids de HSM', () => {
    const dto = toPickupDTO(pickup({ source: 'manual', source_id: null, source_ref: null }))
    expect(dto.rma_id).toBeNull()
    expect(dto.rma_number).toBeNull()
  })
})

describe('helpers', () => {
  it('contenido para TIPSA con numero de serie', () => {
    expect(buildPickupContent(pickup())).toBe('TPV (SN SN1) + Impresora')
  })

  it('referencia con RMA cuando lo hay', () => {
    expect(pickupReference(pickup())).toBe('RC-202610-0001 RMA-2026-00123')
    expect(pickupReference({ pickup_id: 'RC-202610-0002', source_ref: null })).toBe('RC-202610-0002')
  })

  it('shortTime recorta segundos', () => {
    expect(shortTime('09:00:00')).toBe('09:00')
    expect(shortTime(null)).toBeNull()
  })
})
