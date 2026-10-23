/**
 * Tipos TIPSA (Dinapaq SOAP WS).
 * Reflejan los payloads relevantes para el MVP de integracion.
 */

export type TipsaEnv = 'test' | 'prod'

export interface TipsaCredentials {
  agencyCode: string
  clientCode: string
  password: string
}

export interface TipsaSession {
  id: string
  createdAt: number
  trackingBaseUrl: string | null
}

export interface TipsaLoginResult {
  sessionId: string
  clientName: string
  version: string
  trackingBaseUrl: string | null
}

export interface TipsaSender {
  name: string
  address: string
  city: string
  cp: string
  phone: string
}

export interface TipsaRecipient {
  name: string
  address: string
  city: string
  cp: string
  phone?: string
  email?: string
  country?: string
  /**
   * Persona de contacto en el destino (ej. "Juan Garcia").
   * Se envia a TIPSA como strPersContacto (WSDL GrabaEnvio24 linea 2362).
   */
  contactPerson?: string
}

export interface TipsaCreateShipmentInput {
  serviceCode: string
  packages: number
  weightKg: number
  content?: string
  observations?: string
  /**
   * Referencia libre que TIPSA guarda para este envio.
   * Usaremos el operation_id del pedido (ej: HW-202604-0012).
   */
  reference?: string
  recipient: TipsaRecipient
  /**
   * Fecha del envio (YYYY-MM-DD). Por defecto hoy.
   */
  date?: string
  /**
   * Si true, activa boRetorno en GrabaEnvio24 para que TIPSA recoja material
   * del destinatario tras la entrega (envio con retorno / recogida).
   * Por defecto false.
   */
  returnShipment?: boolean
  /**
   * Si true, activa boSabado en GrabaEnvio24 (entrega permitida en sabado).
   * TIPSA aplica restricciones por zona/servicio. Por defecto false.
   */
  saturdayDelivery?: boolean
}

export interface TipsaCreateShipmentResult {
  /** N albaran que usamos como tracking_number */
  albaran: string
  /** GUID TIPSA para construir URL publica */
  guid: string
  deliveryDate: string | null
  packagesCount: number
  rawResponse: string
}

export type TipsaLabelFormat = 'pdf' | 'zpl'

export interface TipsaLabelResult {
  format: TipsaLabelFormat
  /** Contenido en base64 */
  base64: string
  rawResponse: string
}

/**
 * Codigos de estado TIPSA (V_COD_TIPO_EST).
 *
 * Catalogo oficial: pagina 22 ("Tabla de tipos de estados") de
 * docs/integrations/tipsa/extracted/Documentacion/
 *   Documentacion WebServices 64.0_resumen_ES.pdf
 * Las etiquetas vivas estan en TIPSA_EVENT_LABELS (lib/tipsa/services.ts);
 * aqui solo se listan para que el tipo documente algo cierto.
 *
 * OJO: hasta 2026-09-09 este comentario publicaba un mapa deducido y falso
 * (2="Entregado", 3="Incidencia"), que estaba corrido respecto al real.
 */
export type TipsaEventCode =
  | '0'   // Documentado
  | '1'   // En transito
  | '2'   // En reparto
  | '3'   // Entregado      (terminal)
  | '4'   // Incidencia
  | '5'   // Devuelto       (terminal)
  | '6'   // Falta de expedicion
  | '7'   // Recanalizado
  | '14'  // Disponible para recoger
  | '15'  // Entrega parcial
  | string

export interface TipsaShippingEvent {
  code: TipsaEventCode
  label: string
  date: string // ISO
  rawAttributes: Record<string, string>
}

export interface TipsaTrackingResult {
  albaran: string
  events: TipsaShippingEvent[]
  rawResponse: string
}

/**
 * Un delta devuelto por ConsEnvEstIncCambiosEstados: un cambio de estado
 * ocurrido en la ventana temporal solicitada. Incluye el albaran para
 * poder hacer lookup contra orders.tracking_number / shipments.tracking_number.
 */
export interface TipsaTrackingDelta {
  albaran: string
  code: TipsaEventCode
  label: string
  date: string // ISO UTC
  /** Todos los atributos raw del XML (V_OBS_INC, V_COD_TIPO_INC, agencias, etc.). */
  rawAttributes: Record<string, string>
}

/**
 * Resultado paginado de ConsEnvEstIncCambiosEstados.
 * hasMore indica si hay que llamar a la siguiente pagina.
 */
export interface TipsaTrackingDeltasPage {
  deltas: TipsaTrackingDelta[]
  page: number
  totalPages: number
  hasMore: boolean
  rawResponse: string
}

// =========================================================
// Recogidas (GrabaRecogida, ConsRecogida, ConsRecEstados...)
// =========================================================

export interface TipsaPickupParty {
  name: string
  address: string
  city: string
  cp: string
  phone: string
  /** strPersContacto en origen, strPersContactoDes en destino (GrabaRecogida14). */
  contactPerson?: string
}

export interface TipsaCreatePickupInput {
  /** Dia de la recogida, YYYY-MM-DD (hora local Madrid). */
  date: string
  /** Inicio de la franja, HH:MM. */
  timeFrom: string
  /** Fin de la franja, HH:MM. */
  timeTo: string
  packages: number
  weightKg: number
  serviceCode: string
  /** Donde se recoge: el cliente. */
  origin: TipsaPickupParty
  /** A donde se lleva: nuestro almacen o el SAT del proveedor. */
  destination: TipsaPickupParty
  /** strRef. Usamos el RC-YYYYMM-NNNN (y el RMA si viene de HSM). */
  reference?: string
  /** strObs: observaciones para el repartidor en origen. */
  observations?: string
  /** strObsDes: observaciones de destino. */
  destinationObservations?: string
  /** strContenido: que se recoge. */
  content?: string
}

export interface TipsaCreatePickupResult {
  /** strCodOut: codigo de la recogida en TIPSA. */
  code: string
  /** strTipoRecOut (N = normal en los ejemplos). */
  type: string | null
  originAgency: string | null
  destinationAgency: string | null
  /** strGuidOut */
  guid: string | null
  /** strCodEnvioReservadoOut: numero de envio reservado, si TIPSA lo asigna. */
  reservedAlbaran: string | null
  rawResponse: string
}

/** Datos generales de una recogida (ConsRecogida). */
export interface TipsaPickupInfo {
  code: string
  /** V_COD_ENV: el envio que TIPSA genera al realizar la recogida. Null hasta entonces. */
  albaran: string | null
  rawAttributes: Record<string, string>
  rawResponse: string
}

export interface TipsaPickupIncidence {
  /** V_COD_TIPO_INC: AS, NTM, EI... */
  code: string
  label: string
  observations: string | null
  date: string // ISO UTC
  resolved: boolean
  rawAttributes: Record<string, string>
}

export interface TipsaConfig {
  env: TipsaEnv
  credentials: TipsaCredentials
  sender: TipsaSender
  servicesCatalog: Array<{ code: string; label: string }>
}

export interface TipsaError extends Error {
  code?: string
  rawResponse?: string
  httpStatus?: number
}
