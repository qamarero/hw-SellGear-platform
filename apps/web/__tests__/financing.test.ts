// =============================================================
// Tests: planes de financiación (lib/financing.ts).
// Verifica importes, sumas y plazos con IVA, incluida la propiedad
// crítica: la suma de los plazos gross coincide con el total que
// calcula cartTotals sobre la línea única (precio = base total).
// =============================================================

import { describe, it, expect } from 'vitest'
import {
  FINANCING_PLANS,
  FINANCEABLE_CODES,
  isFinanceableCode,
  financingPlanBaseCents,
  financingBaseTotalCents,
  financingInstallments,
} from '@/lib/financing'
import { cartTotals } from '@/lib/pricing'

describe('FINANCING_PLANS', () => {
  it('contiene exactamente los 4 productos financiables del catálogo web', () => {
    // Copia: FINANCEABLE_CODES es readonly y .sort() lo mutaría.
    expect([...FINANCEABLE_CODES].sort()).toEqual(
      ['kds-premium', 'kds-pro', 'pack-premium', 'pack-pro'].sort(),
    )
  })

  it('importes base (céntimos)', () => {
    expect(FINANCING_PLANS['pack-pro']).toEqual([50000, 22500, 22500])
    expect(FINANCING_PLANS['pack-premium']).toEqual([69900, 35000, 35000])
    expect(FINANCING_PLANS['kds-pro']).toEqual([42553, 20653, 20653])
    expect(FINANCING_PLANS['kds-premium']).toEqual([59083, 28752, 28752])
  })
})

describe('isFinanceableCode', () => {
  it('acepta los 4 financiables y rechaza el resto', () => {
    expect(isFinanceableCode('pack-pro')).toBe(true)
    expect(isFinanceableCode('pack-premium')).toBe(true)
    expect(isFinanceableCode('kds-pro')).toBe(true)
    expect(isFinanceableCode('kds-premium')).toBe(true)
    // KDS Standard dejó de financiarse el 2026-10-21, como en la web.
    expect(isFinanceableCode('kds-estandar')).toBe(false)
    expect(isFinanceableCode('pack-esencial')).toBe(false)
    expect(isFinanceableCode('tpv-pro')).toBe(false)
    expect(isFinanceableCode('otro')).toBe(false)
    expect(isFinanceableCode('')).toBe(false)
  })
})

describe('financingBaseTotalCents', () => {
  it('suma las 3 etapas', () => {
    expect(financingBaseTotalCents('pack-pro')).toBe(95000) // 950 €
    expect(financingBaseTotalCents('pack-premium')).toBe(139900) // 1399 €
    expect(financingBaseTotalCents('kds-pro')).toBe(83859)
    expect(financingBaseTotalCents('kds-premium')).toBe(116587)
  })
  it('devuelve null para no financiables', () => {
    expect(financingBaseTotalCents('tpv-estandar')).toBeNull()
    expect(financingPlanBaseCents('cajon')).toBeNull()
  })
})

describe('financingInstallments — IVA 21 % (peninsular)', () => {
  it('Pack Pro: 605 | 272,25 | 272,25', () => {
    const inst = financingInstallments('pack-pro', 21)!
    expect(inst.map((i) => i.grossCents)).toEqual([60500, 27225, 27225])
    expect(inst.map((i) => i.stage)).toEqual([1, 2, 3])
  })

  it('KDS Pro: 514,89 | 249,90 | 249,90 (entrada a ,89 para cuadrar al céntimo)', () => {
    const inst = financingInstallments('kds-pro', 21)!
    expect(inst.map((i) => i.grossCents)).toEqual([51489, 24990, 24990])
  })

  it('KDS Premium: 714,90 | 347,90 | 347,90 = 1.410,70', () => {
    const inst = financingInstallments('kds-premium', 21)!
    expect(inst.map((i) => i.grossCents)).toEqual([71490, 34790, 34790])
    expect(inst.reduce((s, i) => s + i.grossCents, 0)).toBe(141070)
  })

  it('la suma de plazos gross == total de cartTotals sobre la línea única', () => {
    for (const code of FINANCEABLE_CODES) {
      const base = financingBaseTotalCents(code)!
      const inst = financingInstallments(code, 21)!
      const sumGross = inst.reduce((s, i) => s + i.grossCents, 0)
      const totals = cartTotals([
        { priceCents: base, qty: 1, discountPct: 0, vatRate: 21 },
      ])
      expect(sumGross, `code ${code}`).toBe(totals.totalCents)
    }
  })
})

describe('financingInstallments — Canarias (0 %)', () => {
  it('sin IVA, gross == base', () => {
    const inst = financingInstallments('kds-pro', 0)!
    expect(inst.map((i) => i.grossCents)).toEqual([42553, 20653, 20653])
    expect(inst.every((i) => i.vatCents === 0)).toBe(true)
  })
})

describe('financingInstallments — no financiable', () => {
  it('devuelve null', () => {
    expect(financingInstallments('pack-esencial', 21)).toBeNull()
  })
})
