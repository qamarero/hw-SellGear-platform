// =============================================================
// Búsqueda de pedidos del listado /orders, en un solo sitio.
//
// El mismo `.or(...)` estaba escrito tres veces —la carga inicial de /orders,
// el "Cargar 50 más" y el export CSV—, y las tres leen el MISMO parámetro
// `search` de la URL. Con las copias sueltas, un campo añadido a una sola
// hacía que la misma búsqueda diera resultados distintos según por dónde
// entraras, y que el CSV no cuadrara con la tabla que lo generó.
//
// Módulo puro: sin Supabase ni React, testeable sin red.
// =============================================================

/**
 * Campos por los que busca el listado.
 *
 * `tracking_number` es el número de albarán de TIPSA (en `orders` esa columna
 * guarda el albarán tal cual lo devuelve el transportista, ver
 * app/api/tipsa/create-shipment/route.ts). Se busca por él para poder llegar
 * al pedido teniendo el paquete delante. Como el ILIKE lleva comodín a los
 * dos lados, `12023` encuentra igualmente el albarán `0000012023`.
 */
const SEARCH_FIELDS = [
  'customer_name',
  'operation_id',
  'venue_name',
  'tracking_number',
] as const

/**
 * Construye el argumento `or` de PostgREST para el término de búsqueda.
 * Devuelve '' cuando no queda nada que buscar; en ese caso NO se filtra.
 *
 * Los caracteres `, ( ) %` se sustituyen por espacios: los tres primeros
 * rompen el parser de PostgREST —la lista de condiciones va separada por
 * comas— y el `%` convertiría la búsqueda en un comodín que lista la tabla
 * entera. Mismo criterio que `buildMultiFieldOr` en lib/address-book/query.ts.
 */
export function buildOrderSearchOr(search: string): string {
  const safe = search.replace(/[,()"%]/g, ' ').trim()
  if (!safe) return ''
  const fragment = `%${safe}%`
  return SEARCH_FIELDS.map((field) => `${field}.ilike.${fragment}`).join(',')
}
