// =============================================================
// Tests: lib/orders/search.ts — filtro de búsqueda del listado /orders.
//
// Existe porque este `.or(...)` estaba copiado en tres sitios (la carga
// inicial de /orders, el "Cargar 50 más" y el export CSV) y los tres leen el
// mismo parámetro de URL: si uno busca por un campo que los otros no, la misma
// búsqueda da resultados distintos según por dónde entres, y el CSV deja de
// cuadrar con la tabla desde la que se pidió.
// =============================================================

import { describe, it, expect } from 'vitest'
import { buildOrderSearchOr } from '@/lib/orders/search'

describe('buildOrderSearchOr', () => {
  it('busca por los cuatro campos del listado', () => {
    const or = buildOrderSearchOr('bar pepe')

    expect(or).toBe(
      'customer_name.ilike.%bar pepe%,' +
        'operation_id.ilike.%bar pepe%,' +
        'venue_name.ilike.%bar pepe%,' +
        'tracking_number.ilike.%bar pepe%',
    )
  })

  it('incluye el albarán de TIPSA', () => {
    expect(buildOrderSearchOr('0000012023')).toContain(
      'tracking_number.ilike.%0000012023%',
    )
  })

  it('el albarán se encuentra sin escribir los ceros de delante', () => {
    // El comodín va a los dos lados, así que %12023% casa con 0000012023.
    expect(buildOrderSearchOr('12023')).toContain(
      'tracking_number.ilike.%12023%',
    )
  })

  it('neutraliza el comodín: un % no lista la tabla entera', () => {
    expect(buildOrderSearchOr('%')).toBe('')
    expect(buildOrderSearchOr('ba%r')).toContain('customer_name.ilike.%ba r%')
  })

  it('neutraliza lo que rompe el parser de PostgREST', () => {
    // La lista de condiciones va separada por comas: una coma del usuario
    // partiría el filtro en dos condiciones inventadas.
    const or = buildOrderSearchOr('bar, s.l. (centro) "el"')

    expect(or.split(',')).toHaveLength(4)
    expect(or).toContain('customer_name.ilike.%bar  s.l.  centro   el%')
  })

  it('sin término efectivo no filtra', () => {
    expect(buildOrderSearchOr('')).toBe('')
    expect(buildOrderSearchOr('   ')).toBe('')
    expect(buildOrderSearchOr('(),')).toBe('')
  })
})
