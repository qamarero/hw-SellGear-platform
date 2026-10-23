import { XMLParser } from 'fast-xml-parser'
import { tipsaEventLabel, tipsaPickupIncidenceLabel } from './services'
import type {
  TipsaCreatePickupInput,
  TipsaCreatePickupResult,
  TipsaCreateShipmentInput,
  TipsaCreateShipmentResult,
  TipsaCredentials,
  TipsaLabelFormat,
  TipsaLabelResult,
  TipsaLoginResult,
  TipsaPickupIncidence,
  TipsaPickupInfo,
  TipsaSender,
  TipsaShippingEvent,
  TipsaTrackingDelta,
  TipsaTrackingDeltasPage,
  TipsaTrackingResult,
} from './types'

/**
 * Escape XML seguro para texto dentro de tags.
 * TIPSA acepta UTF-8; escapamos &, <, > y comillas.
 */
export function xmlEscape(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const SHARED_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
})

// =========================================================
// LOGIN
// =========================================================

export function buildLoginEnvelope(creds: TipsaCredentials): string {
  // Construido via array + join('\n') para evitar cualquier transformacion
  // de template literals por Turbopack/Next.js que altere bytes del payload.
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">',
    '  <soapenv:Header>',
    '    <tem:ROClientIDHeader>',
    '    </tem:ROClientIDHeader>',
    '  </soapenv:Header>',
    '  <soapenv:Body>',
    '    <tem:LoginWSService___LoginCli2>',
    '      <tem:strCodAge>' + xmlEscape(creds.agencyCode) + '</tem:strCodAge>',
    '      <tem:strCod>' + xmlEscape(creds.clientCode) + '</tem:strCod>',
    '      <tem:strPass>' + xmlEscape(creds.password) + '</tem:strPass>',
    '    </tem:LoginWSService___LoginCli2>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ]
  return lines.join('\n')
}

export function parseLoginResponse(xml: string): TipsaLoginResult {
  const parsed = SHARED_PARSER.parse(xml)
  // Acepta ambos: LoginCli2Response (nuevo) y LoginCliResponse (legacy)
  const body =
    findFirst(parsed, 'LoginWSService___LoginCli2Response') ??
    findFirst(parsed, 'LoginWSService___LoginCliResponse')
  if (!body) {
    throw makeError('Login response malformed: missing LoginCli2Response/LoginCliResponse', xml)
  }
  const result = pick(body, 'Result')
  if (result !== 'true') {
    const errCode = pick(body, 'strError')
    throw makeError(`TIPSA login failed (strError=${errCode})`, xml)
  }
  const sessionId = pick(body, 'strSesion')
  if (!sessionId) {
    throw makeError('Login response missing strSesion', xml)
  }
  return {
    sessionId,
    clientName: pick(body, 'strNom') ?? '',
    version: pick(body, 'strVersion') ?? '',
    trackingBaseUrl: pick(body, 'strURLDetSegEnv') ?? null,
  }
}

// =========================================================
// GRABA ENVIO 24
// =========================================================

export interface GrabaEnvio24Input {
  creds: { agencyCode: string; clientCode: string }
  sessionId: string
  sender: TipsaSender
  input: TipsaCreateShipmentInput
}

export function buildGrabaEnvio24Envelope({
  creds,
  sessionId,
  sender,
  input,
}: GrabaEnvio24Input): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10)
  const rcp = input.recipient
  // Prefijamos el CP a la poblacion destino para que TIPSA lo imprima siempre
  // en la linea del destinatario (sin esto, el renderer omite el CP del bloque DES).
  // El strCPDes sigue enviandose por separado para routing.
  const pobDesWithCp = rcp.cp ? `${rcp.cp} ${rcp.city}` : rcp.city
  const boRetorno = input.returnShipment ? 'true' : 'false'
  const boSabado = input.saturdayDelivery ? 'true' : 'false'

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tem:WebServService___GrabaEnvio24>
      <tem:strCodAgeCargo>${xmlEscape(creds.agencyCode)}</tem:strCodAgeCargo>
      <tem:strCodAgeOri>${xmlEscape(creds.agencyCode)}</tem:strCodAgeOri>
      <tem:dtFecha>${xmlEscape(date)}</tem:dtFecha>
      <tem:strCodTipoServ>${xmlEscape(input.serviceCode)}</tem:strCodTipoServ>
      <tem:strCodCli>${xmlEscape(creds.clientCode)}</tem:strCodCli>
      <tem:strNomOri>${xmlEscape(sender.name)}</tem:strNomOri>
      <tem:strDirOri>${xmlEscape(sender.address)}</tem:strDirOri>
      <tem:strPobOri>${xmlEscape(sender.city)}</tem:strPobOri>
      <tem:strCPOri>${xmlEscape(sender.cp)}</tem:strCPOri>
      <tem:strTlfOri>${xmlEscape(sender.phone)}</tem:strTlfOri>
      <tem:strNomDes>${xmlEscape(rcp.name)}</tem:strNomDes>
      <tem:strDirDes>${xmlEscape(rcp.address)}</tem:strDirDes>
      <tem:strPobDes>${xmlEscape(pobDesWithCp)}</tem:strPobDes>
      <tem:strCPDes>${xmlEscape(rcp.cp)}</tem:strCPDes>
      <tem:strCodPais>${xmlEscape(rcp.country ?? 'ES')}</tem:strCodPais>
      <tem:strTlfDes>${xmlEscape(rcp.phone ?? '')}</tem:strTlfDes>
      <tem:intPaq>${xmlEscape(input.packages)}</tem:intPaq>
      <tem:dPesoOri>${xmlEscape(input.weightKg)}</tem:dPesoOri>
      <tem:boSabado>${boSabado}</tem:boSabado>
      <tem:boRetorno>${boRetorno}</tem:boRetorno>
      <tem:strRef>${xmlEscape(input.reference ?? '')}</tem:strRef>
      <tem:strObs>${xmlEscape(input.observations ?? '')}</tem:strObs>
      <tem:strContenido>${xmlEscape(input.content ?? '')}</tem:strContenido>
      <tem:strPersContacto>${xmlEscape(rcp.contactPerson ?? '')}</tem:strPersContacto>
      <tem:boDesSMS>false</tem:boDesSMS>
      <tem:boDesEmail>${rcp.email ? 'true' : 'false'}</tem:boDesEmail>
      <tem:strDesMoviles>${xmlEscape(rcp.phone ?? '')}</tem:strDesMoviles>
      <tem:strDesDirEmails>${xmlEscape(rcp.email ?? '')}</tem:strDesDirEmails>
      <tem:boInsert>true</tem:boInsert>
    </tem:WebServService___GrabaEnvio24>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function parseGrabaEnvioResponse(xml: string): TipsaCreateShipmentResult {
  const parsed = SHARED_PARSER.parse(xml)
  const body =
    findFirst(parsed, 'WebServService___GrabaEnvio24Response') ??
    findFirst(parsed, 'WebServService___GrabaEnvio18Response') ??
    findFirst(parsed, 'WebServService___GrabaEnvio16Response')
  if (!body) {
    throw makeError('GrabaEnvio response malformed: missing *Response node', xml)
  }
  const albaran = pick(body, 'strAlbaranOut')
  const guid = pick(body, 'strGuidOut') ?? ''
  if (!albaran) {
    throw makeError('GrabaEnvio response missing strAlbaranOut', xml)
  }
  return {
    albaran,
    guid,
    deliveryDate: pick(body, 'dtFecEntrOut') ?? null,
    packagesCount: Number(pick(body, 'intBultosPosteriorOut') ?? '1'),
    rawResponse: xml,
  }
}

// =========================================================
// CONS ETIQUETA ENVIO 6 (PDF/ZPL)
// =========================================================

export interface ConsEtiquetaInput {
  creds: { agencyCode: string }
  sessionId: string
  albaran: string
  format: TipsaLabelFormat
  reportId?: number
}

export function buildConsEtiquetaEnvelope({
  creds,
  sessionId,
  albaran,
  format,
  reportId = 233,
}: ConsEtiquetaInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tem:WebServService___ConsEtiquetaEnvio6>
      <tem:strCodAgeOri>${xmlEscape(creds.agencyCode)}</tem:strCodAgeOri>
      <tem:strCodAgeCargo>${xmlEscape(creds.agencyCode)}</tem:strCodAgeCargo>
      <tem:StrAlbaran>${xmlEscape(albaran)}</tem:StrAlbaran>
      <tem:intIdRepDet>${xmlEscape(reportId)}</tem:intIdRepDet>
      <tem:strFormato>${xmlEscape(format)}</tem:strFormato>
    </tem:WebServService___ConsEtiquetaEnvio6>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function parseConsEtiquetaResponse(
  xml: string,
  format: TipsaLabelFormat,
): TipsaLabelResult {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsEtiquetaEnvio6Response')
  if (!body) {
    throw makeError('ConsEtiqueta response malformed', xml)
  }
  // TIPSA devuelve el PDF como base64 en algun nodo tipo strBase64Out/strEtiquetaOut.
  // Buscamos la primera clave que contenga texto largo (base64).
  const base64 = findBase64Payload(body)
  if (!base64) {
    throw makeError('ConsEtiqueta response missing base64 payload', xml)
  }
  return { format, base64, rawResponse: xml }
}

// =========================================================
// CONS ENV ESTADOS (tracking)
// =========================================================

export interface ConsEnvEstadosInput {
  creds: { agencyCode: string }
  sessionId: string
  albaran: string
}

export function buildConsEnvEstadosEnvelope({
  creds,
  sessionId,
  albaran,
}: ConsEnvEstadosInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tem:WebServService___ConsEnvEstados>
      <tem:strCodAgeCargo>${xmlEscape(creds.agencyCode)}</tem:strCodAgeCargo>
      <tem:strCodAgeOri>${xmlEscape(creds.agencyCode)}</tem:strCodAgeOri>
      <tem:strAlbaran>${xmlEscape(albaran)}</tem:strAlbaran>
    </tem:WebServService___ConsEnvEstados>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function parseConsEnvEstadosResponse(xml: string, albaran: string): TipsaTrackingResult {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsEnvEstadosResponse')
  if (!body) {
    throw makeError('ConsEnvEstados response malformed', xml)
  }
  const cdata = pick(body, 'strEnvEstados') ?? ''
  const events = parseEnvEstadosCdata(cdata)
  return { albaran, events, rawResponse: xml }
}

/**
 * El CDATA devuelve XML tipo:
 *   <CONSULTA><ENV_ESTADOS I_ID="1" V_COD_TIPO_EST="1" D_FEC_HORA_ALTA="02/06/2020 17:28:02" .../>...</CONSULTA>
 * Exportado para poder testearlo directo con fixtures.
 */
export function parseEnvEstadosCdata(cdata: string): TipsaShippingEvent[] {
  return parseEstadosCdata(cdata, 'ENV_ESTADOS')
}

/**
 * Comun a envios (ENV_ESTADOS) y recogidas (REC_ESTADOS): mismos atributos
 * V_COD_TIPO_EST y D_FEC_HORA_ALTA, mismo catalogo de codigos.
 */
function parseEstadosCdata(cdata: string, nodeName: string): TipsaShippingEvent[] {
  if (!cdata.trim()) return []
  const parsed = SHARED_PARSER.parse(cdata)
  const consulta = (parsed as Record<string, unknown>).CONSULTA
  if (!consulta || typeof consulta !== 'object') return []
  const nodes = (consulta as Record<string, unknown>)[nodeName]
  const arr = Array.isArray(nodes) ? nodes : nodes ? [nodes] : []
  return arr
    .map((raw) => {
      const attrs = extractAttrs(raw as Record<string, unknown>)
      const code = attrs['V_COD_TIPO_EST'] ?? ''
      const dateStr = attrs['D_FEC_HORA_ALTA'] ?? ''
      return {
        code,
        label: tipsaEventLabel(code),
        date: parseTipsaDate(dateStr),
        rawAttributes: attrs,
      }
    })
    .filter((e) => e.code.length > 0)
}

/**
 * Fecha TIPSA "MM/DD/YYYY HH:MM:SS" -> ISO UTC.
 *
 * IMPORTANTE 1: TIPSA envia las fechas en formato AMERICANO (MM/DD/YYYY)
 * a pesar de ser un servicio espanol. Confirmado en fixtures oficiales
 * (ej. ConsEnvEstados_code4_response.txt: D_FEC_HORA_ALTA="11/28/2019 17:50:44").
 * El "28" solo puede ser dia, asi que el orden es MM/DD.
 *
 * IMPORTANTE 2: TIPSA emite las horas como hora LOCAL Europe/Madrid
 * (sin sufijo de timezone), no UTC. Esta funcion convierte correctamente
 * a UTC respetando el horario de verano (CEST/CET) via Intl.DateTimeFormat.
 */
export function parseTipsaDate(raw: string): string {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return new Date().toISOString()
  const [, mm, dd, yyyy, hh, mi, ss] = m
  return tipsaLocalToUtcIso(yyyy, mm, dd, hh, mi, ss)
}

/**
 * Convierte una fecha "ingenua" (sin timezone) interpretada como hora local
 * Europe/Madrid a un ISO UTC string.
 *
 * Tecnica estandar V8 sin dependencias externas:
 *  1. Construir Date "ingenuo" como si los componentes fueran UTC.
 *  2. Formatear ese Date con timezone Madrid y comparar componentes.
 *  3. La diferencia es el offset Madrid->UTC para esa fecha (DST aplicado).
 *
 * Ejemplos:
 *  - 06/15/2026 12:00:00 (CEST, +2h) -> 2026-06-15T10:00:00.000Z
 *  - 01/15/2026 12:00:00 (CET, +1h)  -> 2026-01-15T11:00:00.000Z
 */
function tipsaLocalToUtcIso(
  yyyy: string,
  mm: string,
  dd: string,
  hh: string,
  mi: string,
  ss: string,
): string {
  const naiveUtc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(naiveUtc)).map((p) => [p.type, p.value]),
  )
  // Algunos runtimes devuelven "hour=24" para medianoche; normalizamos.
  const hourVal = parts.hour === '24' ? 0 : +parts.hour
  const madridAsUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    hourVal,
    +parts.minute,
    +parts.second,
  )
  const offsetMs = madridAsUtc - naiveUtc
  return new Date(naiveUtc - offsetMs).toISOString()
}

// =========================================================
// CONS ENV EST INC CAMBIOS ESTADOS (deltas globales por ventana temporal)
// =========================================================
// A diferencia de ConsEnvEstados (1 albaran -> N eventos), este metodo
// devuelve TODOS los cambios de estado ocurridos en el rango
// [dtFecHoraEstadoInicio, dtFecHoraEstadoFin] para TODOS los envios del
// cliente, en 1 sola llamada paginada. Es el metodo que usa el cron.

export interface ConsEnvEstIncCambiosEstadosInput {
  sessionId: string
  /** Fecha ISO UTC. Se convierte a "YYYY/MM/DD HH:MM:SS" (hora Madrid) para TIPSA. */
  sinceDate: string
  /** Fecha ISO UTC. Idem. */
  untilDate: string
  /** Numero de pagina (0-based). */
  page?: number
}

/**
 * Convierte una fecha ISO UTC al formato que espera este endpoint TIPSA:
 * "YYYY/MM/DD HH:MM:SS" en hora local Europe/Madrid (sin sufijo TZ).
 *
 * Ojo: el request usa YYYY/MM/DD (formato europeo con /), a diferencia
 * de la RESPUESTA que TIPSA emite en MM/DD/YYYY (formato US). No es
 * inconsistencia mia — asi es TIPSA.
 */
export function formatTipsaRequestDate(isoUtc: string): string {
  const d = new Date(isoUtc)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  const hh = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}/${parts.month}/${parts.day} ${hh}:${parts.minute}:${parts.second}`
}

export function buildConsEnvEstIncCambiosEstadosEnvelope({
  sessionId,
  sinceDate,
  untilDate,
  page = 0,
}: ConsEnvEstIncCambiosEstadosInput): string {
  const since = formatTipsaRequestDate(sinceDate)
  const until = formatTipsaRequestDate(untilDate)
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tem:WebServService___ConsEnvEstIncCambiosEstados>
      <tem:dtFecHoraEstadoInicio>${xmlEscape(since)}</tem:dtFecHoraEstadoInicio>
      <tem:dtFecHoraEstadoFin>${xmlEscape(until)}</tem:dtFecHoraEstadoFin>
      <tem:iPagina>${xmlEscape(page)}</tem:iPagina>
    </tem:WebServService___ConsEnvEstIncCambiosEstados>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function parseConsEnvEstIncCambiosEstadosResponse(
  xml: string,
  requestedPage = 0,
): TipsaTrackingDeltasPage {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsEnvEstIncCambiosEstadosResponse')
  if (!body) {
    throw makeError('ConsEnvEstIncCambiosEstados response malformed', xml)
  }
  // CDATA con XML anidado <CONSULTA><ENV_EST_INC_CAMBIOS_ESTADOS .../>...</CONSULTA>
  const cdata = pick(body, 'strEnvEstIncCambioEstado') ?? ''
  const deltas = parseEnvEstIncCambiosCdata(cdata)
  const totalPagesRaw = pick(body, 'iTotalPaginasOut')
  const totalPages = totalPagesRaw ? Number(totalPagesRaw) : 1
  return {
    deltas,
    page: requestedPage,
    totalPages,
    hasMore: requestedPage + 1 < totalPages,
    rawResponse: xml,
  }
}

/**
 * Parsea el CDATA de deltas. Cada nodo ENV_EST_INC_CAMBIOS_ESTADOS trae
 * V_ALBARAN, V_COD_TIPO_EST, D_FEC_HORA_ALTA_EST + campos _INC opcionales
 * (V_OBS_INC = observacion de la incidencia si el codigo es 3).
 */
export function parseEnvEstIncCambiosCdata(cdata: string): TipsaTrackingDelta[] {
  if (!cdata.trim()) return []
  const parsed = SHARED_PARSER.parse(cdata)
  const consulta = (parsed as Record<string, unknown>).CONSULTA
  if (!consulta || typeof consulta !== 'object') return []
  const nodes = (consulta as Record<string, unknown>).ENV_EST_INC_CAMBIOS_ESTADOS
  const arr = Array.isArray(nodes) ? nodes : nodes ? [nodes] : []
  return arr
    .map((raw) => {
      const attrs = extractAttrs(raw as Record<string, unknown>)
      const code = attrs['V_COD_TIPO_EST'] ?? ''
      const albaran = attrs['V_ALBARAN'] ?? ''
      // Formato MM/DD/YYYY HH:MM:SS (hora Madrid) — usa el parser existente.
      const dateStr = attrs['D_FEC_HORA_ALTA_EST'] ?? ''
      return {
        albaran,
        code,
        label: tipsaEventLabel(code),
        date: parseTipsaDate(dateStr),
        rawAttributes: attrs,
      }
    })
    .filter((d) => d.code.length > 0 && d.albaran.length > 0)
}

// =========================================================
// RECOGIDAS
// =========================================================
// Una recogida es TIPSA yendo a buscar material a un tercero (el cliente)
// para llevarlo a donde digamos. La paga nuestra agencia (strCodAgeCargo).
// No mandamos strCodAgeOri/strCodAgeDes: TIPSA las canaliza por CP, que es
// justo lo que queremos (la agencia de origen es la del cliente, no la nuestra
// de Sevilla). Ver docs/integrations/tipsa/extracted/Ejemplos/GrabaRecogida/.

/**
 * Version del metodo. Nuestro WSDL llega a la 12; el PDF v74.0 documenta la
 * 14 (anade tipo de transito y contacto de destino). Si TIPSA nos pide otra,
 * se cambia aqui: el parser acepta cualquier GrabaRecogidaNResponse.
 */
export const GRABA_RECOGIDA_METHOD = 'GrabaRecogida12'

export interface GrabaRecogidaInput {
  creds: { agencyCode: string; clientCode: string }
  sessionId: string
  input: TipsaCreatePickupInput
}

export function buildGrabaRecogidaEnvelope({
  creds,
  sessionId,
  input,
}: GrabaRecogidaInput): string {
  // Peticion: YYYY/MM/DD y YYYY/MM/DD HH:MM:SS en hora de Madrid, igual que
  // ConsEnvEstIncCambiosEstados. La fecha y la franja ya vienen en local.
  const day = input.date.replace(/-/g, '/')
  const ori = input.origin
  const des = input.destination
  const tag = `tem:WebServService___${GRABA_RECOGIDA_METHOD}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <${tag}>
      <tem:strCodAgeSol>${xmlEscape(creds.agencyCode)}</tem:strCodAgeSol>
      <tem:strCodAgeCargo>${xmlEscape(creds.agencyCode)}</tem:strCodAgeCargo>
      <tem:dtFecRec>${xmlEscape(day)}</tem:dtFecRec>
      <tem:dtHoraRecIni>${xmlEscape(`${day} ${input.timeFrom}:00`)}</tem:dtHoraRecIni>
      <tem:dtHoraRecFin>${xmlEscape(`${day} ${input.timeTo}:00`)}</tem:dtHoraRecFin>
      <tem:intBul>${xmlEscape(input.packages)}</tem:intBul>
      <tem:dPeso>${xmlEscape(input.weightKg)}</tem:dPeso>
      <tem:strNomOri>${xmlEscape(ori.name)}</tem:strNomOri>
      <tem:strDirOri>${xmlEscape(ori.address)}</tem:strDirOri>
      <tem:strPobOri>${xmlEscape(ori.city)}</tem:strPobOri>
      <tem:strCPOri>${xmlEscape(ori.cp)}</tem:strCPOri>
      <tem:strTlfOri>${xmlEscape(ori.phone)}</tem:strTlfOri>
      <tem:strNomDes>${xmlEscape(des.name)}</tem:strNomDes>
      <tem:strDirDes>${xmlEscape(des.address)}</tem:strDirDes>
      <tem:strPobDes>${xmlEscape(des.city)}</tem:strPobDes>
      <tem:strCPDes>${xmlEscape(des.cp)}</tem:strCPDes>
      <tem:strTlfDes>${xmlEscape(des.phone)}</tem:strTlfDes>
      <tem:strObs>${xmlEscape(input.observations ?? '')}</tem:strObs>
      <tem:strCodCli>${xmlEscape(creds.clientCode)}</tem:strCodCli>
      <tem:strPersContacto>${xmlEscape(ori.contactPerson ?? ori.name)}</tem:strPersContacto>
      <tem:strCodTipoServ>${xmlEscape(input.serviceCode)}</tem:strCodTipoServ>
      <tem:boSabado>false</tem:boSabado>
      <tem:strRef>${xmlEscape(input.reference ?? '')}</tem:strRef>
      <tem:strObsDes>${xmlEscape(input.destinationObservations ?? '')}</tem:strObsDes>
      <tem:strContenido>${xmlEscape(input.content ?? '')}</tem:strContenido>
    </${tag}>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function parseGrabaRecogidaResponse(xml: string): TipsaCreatePickupResult {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirstMatching(parsed, /^WebServService___GrabaRecogida\d*Response$/)
  if (!body) {
    throw makeError('GrabaRecogida response malformed: missing *Response node', xml)
  }
  const code = pick(body, 'strCodOut')
  if (!code) {
    throw makeError('GrabaRecogida response missing strCodOut', xml)
  }
  return {
    code,
    type: emptyToNull(pick(body, 'strTipoRecOut')),
    originAgency: emptyToNull(pick(body, 'strCodAgeOriOut')),
    destinationAgency: emptyToNull(pick(body, 'strCodAgeDesOut')),
    guid: emptyToNull(pick(body, 'strGuidOut')),
    reservedAlbaran: emptyToNull(pick(body, 'strCodEnvioReservadoOut')),
    rawResponse: xml,
  }
}

/** Sobre minimo de los metodos de recogida que solo piden el codigo. */
function buildPickupCodeEnvelope(method: string, paramName: string, sessionId: string, code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header>
    <tem:ROClientIDHeader>
      <tem:ID>${xmlEscape(sessionId)}</tem:ID>
    </tem:ROClientIDHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tem:WebServService___${method}>
      <tem:${paramName}>${xmlEscape(code)}</tem:${paramName}>
    </tem:WebServService___${method}>
  </soapenv:Body>
</soapenv:Envelope>`
}

export function buildConsRecEstadosEnvelope(sessionId: string, code: string): string {
  return buildPickupCodeEnvelope('ConsRecEstados', 'strCodRec', sessionId, code)
}

export function buildConsRecogidaEnvelope(sessionId: string, code: string): string {
  return buildPickupCodeEnvelope('ConsRecogida', 'strCod', sessionId, code)
}

export function buildConsRecIncidenciasEnvelope(sessionId: string, code: string): string {
  return buildPickupCodeEnvelope('ConsRecIncidencias', 'strCodRec', sessionId, code)
}

export function buildBorraRecogidaEnvelope(sessionId: string, code: string): string {
  return buildPickupCodeEnvelope('BorraRecogida', 'strCodRec', sessionId, code)
}

/** Historial de estados de la recogida. Mismo formato y codigos que ConsEnvEstados. */
export function parseConsRecEstadosResponse(xml: string): TipsaShippingEvent[] {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsRecEstadosResponse')
  if (!body) {
    throw makeError('ConsRecEstados response malformed', xml)
  }
  return parseEstadosCdata(pick(body, 'strRecEstados') ?? '', 'REC_ESTADOS')
}

/**
 * Datos generales de la recogida. Lo que nos importa es V_COD_ENV: TIPSA lo
 * rellena con el albaran del envio que genera al realizar la recogida, y es
 * la unica senal fiable de que el material ya esta en camino.
 */
export function parseConsRecogidaResponse(xml: string): TipsaPickupInfo {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsRecogidaResponse')
  if (!body) {
    throw makeError('ConsRecogida response malformed', xml)
  }
  const cdata = pick(body, 'strRecogida') ?? ''
  const node = cdata.trim() ? firstCdataNode(cdata, 'RECOGIDAS') : null
  if (!node) {
    throw makeError('ConsRecogida response without RECOGIDAS node', xml)
  }
  const attrs = extractAttrs(node)
  return {
    code: attrs['V_COD'] ?? '',
    albaran: emptyToNull(attrs['V_COD_ENV']),
    rawAttributes: attrs,
    rawResponse: xml,
  }
}

/**
 * Incidencias de la recogida (ausente, no tienen mercancia...). El CDATA es
 *   <CONSULTA><REC_INCIDENCIAS><INC .../><ACT .../></REC_INCIDENCIAS></CONSULTA>
 * Las ACT son actuaciones sobre la incidencia; aqui solo leemos las INC.
 */
export function parseConsRecIncidenciasResponse(xml: string): TipsaPickupIncidence[] {
  const parsed = SHARED_PARSER.parse(xml)
  const body = findFirst(parsed, 'WebServService___ConsRecIncidenciasResponse')
  if (!body) {
    throw makeError('ConsRecIncidencias response malformed', xml)
  }
  const cdata = pick(body, 'strRecIncidencias') ?? ''
  if (!cdata.trim()) return []
  const inner = findFirst(SHARED_PARSER.parse(cdata), 'REC_INCIDENCIAS')
  if (!inner) return []
  const nodes = inner.INC
  const arr = Array.isArray(nodes) ? nodes : nodes ? [nodes] : []
  return arr
    .map((raw) => {
      const attrs = extractAttrs(raw as Record<string, unknown>)
      const code = attrs['V_COD_TIPO_INC'] ?? ''
      return {
        code,
        label: tipsaPickupIncidenceLabel(code),
        observations: emptyToNull(attrs['T_OBS']),
        date: parseTipsaDate(attrs['D_FEC_HORA_ALTA'] ?? ''),
        resolved: /^(true|1|s)$/i.test(attrs['B_RESUELTA'] ?? ''),
        rawAttributes: attrs,
      }
    })
    .filter((i) => i.code.length > 0)
}

/**
 * BorraRecogida devuelve intCodErrorOut. La tabla del PDF v74.0 sale
 * descolocada al extraerla; lo que se lee es 1 = la recogida no existe,
 * 2 = sin permisos para borrarla, 3 = error desconocido. 0 o vacio = borrada.
 */
export const BORRA_RECOGIDA_ERRORS: Record<string, string> = {
  '1': 'La recogida no existe en TIPSA',
  '2': 'No tenemos permisos para anular esta recogida en TIPSA',
  '3': 'TIPSA no ha podido anular la recogida (error desconocido)',
}

export function parseBorraRecogidaResponse(xml: string): { errorCode: string | null } {
  const parsed = SHARED_PARSER.parse(xml)
  const body =
    findFirst(parsed, 'WebServService___BorraRecogidaResponse') ??
    findFirst(parsed, 'WebServService___BorraRecogida')
  if (!body) {
    throw makeError('BorraRecogida response malformed', xml)
  }
  const code = (pick(body, 'intCodErrorOut') ?? '').trim()
  return { errorCode: code === '' || code === '0' ? null : code }
}

// =========================================================
// Helpers
// =========================================================

function findFirstMatching(root: unknown, pattern: RegExp): Record<string, unknown> | null {
  if (!root || typeof root !== 'object') return null
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const obj = cur as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (pattern.test(k) && v && typeof v === 'object') return v as Record<string, unknown>
      stack.push(v)
    }
  }
  return null
}

function firstCdataNode(cdata: string, nodeName: string): Record<string, unknown> | null {
  const found = findFirst(SHARED_PARSER.parse(cdata), nodeName)
  // Si TIPSA devolviera varias filas, fast-xml-parser da un array: la primera.
  if (Array.isArray(found)) return (found[0] as Record<string, unknown>) ?? null
  return found
}

function emptyToNull(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t ? t : null
}

function findFirst(root: unknown, tagName: string): Record<string, unknown> | null {
  if (!root || typeof root !== 'object') return null
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const obj = cur as Record<string, unknown>
    if (tagName in obj) {
      const v = obj[tagName]
      if (v && typeof v === 'object') return v as Record<string, unknown>
    }
    for (const k of Object.keys(obj)) {
      stack.push(obj[k])
    }
  }
  return null
}

function pick(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  // fast-xml-parser returns {'#text': '...'} for nodes with attributes
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)['#text'])
  }
  return undefined
}

function extractAttrs(node: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith('@_')) continue
    out[k.slice(2)] = typeof v === 'string' ? v : String(v)
  }
  return out
}

function findBase64Payload(body: Record<string, unknown>): string | null {
  // Heuristica: TIPSA usa distintos nombres de campo segun version.
  // Buscamos una cadena larga de base64 en cualquier tag hijo.
  for (const v of Object.values(body)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed.length > 200 && /^[A-Za-z0-9+/=\r\n\s]+$/.test(trimmed)) {
        return trimmed.replace(/\s+/g, '')
      }
    }
    if (v && typeof v === 'object') {
      const nested = findBase64Payload(v as Record<string, unknown>)
      if (nested) return nested
    }
  }
  return null
}

function makeError(message: string, rawResponse: string, httpStatus?: number): Error {
  const err = new Error(message) as Error & { rawResponse: string; httpStatus?: number }
  err.rawResponse = rawResponse
  if (httpStatus !== undefined) err.httpStatus = httpStatus
  return err
}
