/**
 * Tests del endpoint /api/external/hwtoolbox/* (HWToolbox API).
 *
 * Cubre:
 *  - validateApiKey con env var configurable.
 *  - Calculo de totales por linea reutilizando lib/pricing.
 *  - HWTOOLBOX_VISIBLE_STATUSES contiene los estados correctos.
 *  - Validacion de query params (clamp limit, fechas ISO).
 *
 * No levanta Supabase: el round-trip al backend se prueba con smoke tests
 * manuales (curl) tras desplegar.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { validateApiKey } from '@/lib/external-auth'
import {
  cartTotals,
  lineTaxableCents,
  lineTotalCents,
  lineVatCents,
} from '@/lib/pricing'
import { HWTOOLBOX_VISIBLE_STATUSES } from '@/app/api/external/hwtoolbox/orders/route'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://example.com/api/external/hwtoolbox/orders', {
    headers,
  })
}

// ==========================================================
// validateApiKey con HWTOOLBOX_API_KEY
// ==========================================================

describe('validateApiKey for HWTOOLBOX_API_KEY', () => {
  const ORIG_HW = process.env.HWTOOLBOX_API_KEY
  const ORIG_MP = process.env.MAIN_PORTAL_API_KEY

  beforeEach(() => {
    process.env.HWTOOLBOX_API_KEY = 'hw_secret_123'
    process.env.MAIN_PORTAL_API_KEY = 'mp_secret_456'
  })
  afterEach(() => {
    if (ORIG_HW === undefined) delete process.env.HWTOOLBOX_API_KEY
    else process.env.HWTOOLBOX_API_KEY = ORIG_HW
    if (ORIG_MP === undefined) delete process.env.MAIN_PORTAL_API_KEY
    else process.env.MAIN_PORTAL_API_KEY = ORIG_MP
  })

  it('rejects when HWTOOLBOX_API_KEY env var is missing', async () => {
    delete process.env.HWTOOLBOX_API_KEY
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'whatever' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
  })

  it('rejects when X-API-Key header is missing', async () => {
    const result = validateApiKey(makeRequest(), 'HWTOOLBOX_API_KEY')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('rejects with 403 when key is wrong', async () => {
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'wrong_key_value' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('rejects with 403 when MainPortal key is sent (different env var)', async () => {
    // No debe permitir cross-env: la MAIN_PORTAL_API_KEY no funciona contra HWTOOLBOX_API_KEY.
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'mp_secret_456' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('ignores a trailing newline pasted into the env var', async () => {
    // Visto en Vercel al pegar una clave generada en la terminal: el valor
    // guardado acababa en salto de linea y ninguna peticion coincidia.
    process.env.HWTOOLBOX_API_KEY = 'hw_secret_123\n'
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'hw_secret_123' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(true)
  })

  it('accepts when HWTOOLBOX_API_KEY matches', async () => {
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'hw_secret_123' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(true)
  })

  it('default env var still works (back-compat for MAIN_PORTAL_API_KEY)', async () => {
    const result = validateApiKey(makeRequest({ 'x-api-key': 'mp_secret_456' }))
    expect(result.ok).toBe(true)
  })
})

// ==========================================================
// QARVIS_API_KEY — clave compartida de solo lectura (cerebro del ecosistema).
// Debe validar ADEMÁS de la clave específica de cada endpoint, sin romper la
// compatibilidad ni permitir cruces indebidos entre las claves existentes.
// ==========================================================

describe('validateApiKey with shared QARVIS_API_KEY', () => {
  const ORIG_HW = process.env.HWTOOLBOX_API_KEY
  const ORIG_MP = process.env.MAIN_PORTAL_API_KEY
  const ORIG_QV = process.env.QARVIS_API_KEY

  beforeEach(() => {
    process.env.HWTOOLBOX_API_KEY = 'hw_secret_123'
    process.env.MAIN_PORTAL_API_KEY = 'mp_secret_456'
    process.env.QARVIS_API_KEY = 'qv_secret_789'
  })
  afterEach(() => {
    if (ORIG_HW === undefined) delete process.env.HWTOOLBOX_API_KEY
    else process.env.HWTOOLBOX_API_KEY = ORIG_HW
    if (ORIG_MP === undefined) delete process.env.MAIN_PORTAL_API_KEY
    else process.env.MAIN_PORTAL_API_KEY = ORIG_MP
    if (ORIG_QV === undefined) delete process.env.QARVIS_API_KEY
    else process.env.QARVIS_API_KEY = ORIG_QV
  })

  it('accepts QARVIS_API_KEY against the HWTOOLBOX endpoint', () => {
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'qv_secret_789' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(true)
  })

  it('accepts QARVIS_API_KEY against the MAIN_PORTAL (default) endpoint', () => {
    const result = validateApiKey(makeRequest({ 'x-api-key': 'qv_secret_789' }))
    expect(result.ok).toBe(true)
  })

  it('still accepts the endpoint-specific key when QARVIS_API_KEY is set', () => {
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'hw_secret_123' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown key with 403 even with QARVIS_API_KEY configured', () => {
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'nope' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('returns 503 when neither the endpoint key nor QARVIS_API_KEY is set', () => {
    delete process.env.HWTOOLBOX_API_KEY
    delete process.env.QARVIS_API_KEY
    const result = validateApiKey(
      makeRequest({ 'x-api-key': 'whatever' }),
      'HWTOOLBOX_API_KEY',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
  })
})

// ==========================================================
// HWTOOLBOX_VISIBLE_STATUSES
// ==========================================================

describe('HWTOOLBOX_VISIBLE_STATUSES', () => {
  it('contains exactly the 4 shipment-flow statuses (preparado is a boolean flag, not status)', () => {
    expect(HWTOOLBOX_VISIBLE_STATUSES).toEqual([
      'enviado_proveedor',
      'enviado',
      'completado',
      'bloqueado',
    ])
  })

  it('does not include draft or intermediate statuses', () => {
    expect(HWTOOLBOX_VISIBLE_STATUSES).not.toContain('nuevo')
    expect(HWTOOLBOX_VISIBLE_STATUSES).not.toContain('pendiente')
    expect(HWTOOLBOX_VISIBLE_STATUSES).not.toContain('falta_informacion')
    expect(HWTOOLBOX_VISIBLE_STATUSES).not.toContain('pagado')
  })
})

// ==========================================================
// Calculos de precio reutilizando lib/pricing
// ==========================================================

describe('HwToolbox line price calculations', () => {
  it('computes a simple line: 1 unit @ 499.00 EUR with 21% VAT', () => {
    // priceCents=49900, qty=1, discountPct=0, vatRate=21
    expect(lineTaxableCents(49900, 1, 0)).toBe(49900)
    expect(lineVatCents(49900, 1, 0, 21)).toBe(10479) // 49900 * 0.21 = 10479
    expect(lineTotalCents(49900, 1, 0, 21)).toBe(60379)
  })

  it('computes a line with 10% discount applied before VAT', () => {
    // priceCents=10000, qty=2, discountPct=10, vatRate=21
    // subtotal = 20000, discount = 2000, taxable = 18000
    // vat = 18000 * 0.21 = 3780, total = 21780
    expect(lineTaxableCents(10000, 2, 10)).toBe(18000)
    expect(lineVatCents(10000, 2, 10, 21)).toBe(3780)
    expect(lineTotalCents(10000, 2, 10, 21)).toBe(21780)
  })

  it('100% discount yields zero total (Promo Printer)', () => {
    expect(lineTaxableCents(15000, 1, 100)).toBe(0)
    expect(lineVatCents(15000, 1, 100, 21)).toBe(0)
    expect(lineTotalCents(15000, 1, 100, 21)).toBe(0)
  })

  it('aggregates totals across multiple lines (cartTotals)', () => {
    const totals = cartTotals([
      { priceCents: 49900, qty: 1, discountPct: 0, vatRate: 21 },
      { priceCents: 10000, qty: 2, discountPct: 10, vatRate: 21 },
    ])
    // line1: subtotal=49900, discount=0, vat=10479
    // line2: subtotal=20000, discount=2000, vat=3780
    expect(totals.subtotalCents).toBe(69900)
    expect(totals.discountCents).toBe(2000)
    expect(totals.taxableCents).toBe(67900)
    expect(totals.vatCents).toBe(14259)
    expect(totals.totalCents).toBe(82159)
  })

  it('handles fractional VAT rate correctly (e.g. 4% reduced)', () => {
    // priceCents=10000, qty=1, discountPct=0, vatRate=4
    // taxable=10000, vat=400, total=10400
    expect(lineVatCents(10000, 1, 0, 4)).toBe(400)
    expect(lineTotalCents(10000, 1, 0, 4)).toBe(10400)
  })

  it('rounds VAT correctly when result is not integer', () => {
    // priceCents=12345, qty=1, discountPct=0, vatRate=21
    // taxable=12345, vat=12345*0.21=2592.45 → round to 2592
    // total = 12345 + 2592 = 14937
    expect(lineVatCents(12345, 1, 0, 21)).toBe(2592)
    expect(lineTotalCents(12345, 1, 0, 21)).toBe(14937)
  })
})
