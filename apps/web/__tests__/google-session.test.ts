// =============================================================
// Tests: sesión válida (solo Google, @qamarero.com, 7 días) y
// destino seguro tras el login.
// =============================================================

import { describe, it, expect } from 'vitest'
import { googleSessionStatus, safeNextPath } from '@/lib/google-session'

const now = Date.parse('2026-10-28T12:00:00Z')
const daysAgo = (days: number) => (now - days * 24 * 60 * 60 * 1000) / 1000
const google = (days = 0) => [{ method: 'oauth', timestamp: daysAgo(days) }]

describe('googleSessionStatus', () => {
  it('acepta Google + @qamarero.com de los últimos 7 días', () => {
    expect(googleSessionStatus({ email: 'ana@qamarero.com', amr: google() }, now)).toBe('valid')
    expect(googleSessionStatus({ email: 'Ana@Qamarero.com', amr: google(6.9) }, now)).toBe('valid')
  })

  it('pide volver a entrar pasados 7 días', () => {
    expect(googleSessionStatus({ email: 'ana@qamarero.com', amr: google(7.1) }, now)).toBe('expired')
  })

  it('rechaza contraseñas, otros dominios y claims raros', () => {
    const password = [{ method: 'password', timestamp: daysAgo(0) }]
    expect(googleSessionStatus({ email: 'ana@qamarero.com', amr: password }, now)).toBe('invalid')
    expect(googleSessionStatus({ email: 'ana@gmail.com', amr: google() }, now)).toBe('invalid')
    expect(googleSessionStatus({ email: 'kekenac201@epaynine.com', amr: google() }, now)).toBe('invalid')
    expect(googleSessionStatus({ email: 'ana@qamarero.com' }, now)).toBe('invalid')
    expect(googleSessionStatus({ email: 'ana@qamarero.com', amr: [{ method: 'oauth' }] }, now)).toBe('invalid')
    expect(googleSessionStatus(null, now)).toBe('invalid')
  })
})

describe('safeNextPath', () => {
  it('mantiene rutas internas', () => {
    expect(safeNextPath('/orders/123?tab=items')).toBe('/orders/123?tab=items')
  })

  it('no deja salir a otro dominio', () => {
    for (const value of ['//evil.com', '/\\evil.com', '@evil.com', 'https://evil.com', '', null, undefined]) {
      expect(safeNextPath(value)).toBe('/orders')
    }
  })
})
