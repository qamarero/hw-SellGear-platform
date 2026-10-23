/**
 * Estado de negocio de una recogida a partir de lo que dice TIPSA.
 * Solo servidor (importa lib/tipsa/services).
 */
import { TIPSA_INCIDENCE_CODE, resolveOfficialStatus } from '@/lib/tipsa/services'
import type { PickupStatus } from '@/types/database'

export interface DeriveInput {
  /** Estados de la recogida (ConsRecEstados), cronologicos ascendentes. */
  pickupCodes: string[]
  /** V_COD_ENV de ConsRecogida: el envio generado al recoger. */
  albaran: string | null
  /** Estados de ese envio (ConsEnvEstados), cronologicos ascendentes. */
  shipmentCodes: string[]
}

/**
 * Reglas (contrato, seccion "Estados"):
 *  - Hay albaran generado  -> el material ya esta recogido. Sobre ese envio:
 *      3 ENTREGADO -> recibida · 4 INCIDENCIA -> incidencia · resto -> en_curso.
 *      Con la regla de resolveOfficialStatus: un 3 manda aunque venga algo despues.
 *  - Sin albaran -> todavia no se ha recogido:
 *      ultimo estado 4 -> incidencia · resto -> programada.
 *
 * Los codigos 11-14 NO mueven el estado: su significado en recogidas no esta
 * verificado contra la web de TIPSA (ver "Las tres trampas" en
 * docs/integrations/tipsa/HANDOFF.md). Solo cuenta el albaran.
 *
 * Nunca devuelve solicitada ni anulada: esas las decide la app, no TIPSA.
 */
export function derivePickupStatus(input: DeriveInput): Exclude<PickupStatus, 'solicitada' | 'anulada'> {
  if (input.albaran) {
    const official = resolveOfficialStatus(input.shipmentCodes, (c) => c)
    if (official === '3') return 'recibida'
    if (official === TIPSA_INCIDENCE_CODE) return 'incidencia'
    return 'en_curso'
  }
  const last = input.pickupCodes[input.pickupCodes.length - 1]
  return last === TIPSA_INCIDENCE_CODE ? 'incidencia' : 'programada'
}
