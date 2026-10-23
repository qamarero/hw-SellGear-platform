/**
 * Cliente SOAP TIPSA minimal.
 * - Sesion cacheada en memoria con TTL 25 min (TIPSA expira cerca de 30).
 * - Reintento automatico 1 vez tras relogin si la sesion ha caducado.
 * - Sin deps externas: fetch + fast-xml-parser (via envelopes.ts).
 */

import {
  BORRA_RECOGIDA_ERRORS,
  GRABA_RECOGIDA_METHOD,
  buildBorraRecogidaEnvelope,
  buildConsEnvEstadosEnvelope,
  buildConsEnvEstIncCambiosEstadosEnvelope,
  buildConsEtiquetaEnvelope,
  buildConsRecEstadosEnvelope,
  buildConsRecIncidenciasEnvelope,
  buildConsRecogidaEnvelope,
  buildGrabaEnvio24Envelope,
  buildGrabaRecogidaEnvelope,
  buildLoginEnvelope,
  parseBorraRecogidaResponse,
  parseConsEnvEstadosResponse,
  parseConsEnvEstIncCambiosEstadosResponse,
  parseConsEtiquetaResponse,
  parseConsRecEstadosResponse,
  parseConsRecIncidenciasResponse,
  parseConsRecogidaResponse,
  parseGrabaEnvioResponse,
  parseGrabaRecogidaResponse,
  parseLoginResponse,
} from './envelopes'
import { TIPSA_URLS } from './services'
import type {
  TipsaConfig,
  TipsaCreatePickupInput,
  TipsaCreatePickupResult,
  TipsaCreateShipmentInput,
  TipsaCreateShipmentResult,
  TipsaLabelFormat,
  TipsaLabelResult,
  TipsaLoginResult,
  TipsaPickupIncidence,
  TipsaPickupInfo,
  TipsaSession,
  TipsaShippingEvent,
  TipsaTrackingDelta,
  TipsaTrackingResult,
} from './types'

const SESSION_TTL_MS = 25 * 60 * 1000

// Cache en memoria por (env + agency + client) para permitir multi-env en el mismo proceso.
const sessionCache = new Map<string, TipsaSession>()

function cacheKey(config: TipsaConfig): string {
  return `${config.env}:${config.credentials.agencyCode}:${config.credentials.clientCode}`
}

function isSessionFresh(session: TipsaSession): boolean {
  return Date.now() - session.createdAt < SESSION_TTL_MS
}

/**
 * Abre (o reutiliza) sesion TIPSA.
 */
export async function login(config: TipsaConfig): Promise<TipsaLoginResult> {
  const key = cacheKey(config)
  const cached = sessionCache.get(key)
  if (cached && isSessionFresh(cached)) {
    return {
      sessionId: cached.id,
      clientName: '',
      version: '',
      trackingBaseUrl: cached.trackingBaseUrl,
    }
  }

  const body = buildLoginEnvelope(config.credentials)
  const xml = await postSoap(TIPSA_URLS[config.env].login, body, 'urn:DinaPaq-LoginWSService#LoginCli2')
  const parsed = parseLoginResponse(xml)
  sessionCache.set(key, {
    id: parsed.sessionId,
    createdAt: Date.now(),
    trackingBaseUrl: parsed.trackingBaseUrl,
  })
  return parsed
}

function invalidateSession(config: TipsaConfig): void {
  sessionCache.delete(cacheKey(config))
}

async function withSession<T>(
  config: TipsaConfig,
  action: (session: TipsaSession) => Promise<T>,
): Promise<T> {
  const key = cacheKey(config)
  let session = sessionCache.get(key)
  if (!session || !isSessionFresh(session)) {
    await login(config)
    session = sessionCache.get(key)!
  }
  try {
    return await action(session)
  } catch (err) {
    // Si falla, intentamos relogin una vez (sesion puede haber caducado antes de TTL).
    if (isSessionError(err)) {
      invalidateSession(config)
      await login(config)
      const fresh = sessionCache.get(key)!
      return action(fresh)
    }
    throw err
  }
}

function isSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const raw = (err as Error & { rawResponse?: string }).rawResponse ?? ''
  return /sesion|session|no.*valid|expired/i.test(raw) ||
    /sesion|session|no.*valid|expired/i.test(err.message)
}

/**
 * Crea envio en TIPSA (GrabaEnvio24).
 */
export async function createShipment(
  config: TipsaConfig,
  input: TipsaCreateShipmentInput,
): Promise<TipsaCreateShipmentResult> {
  return withSession(config, async (session) => {
    const body = buildGrabaEnvio24Envelope({
      creds: config.credentials,
      sessionId: session.id,
      sender: config.sender,
      input,
    })
    const xml = await postSoap(TIPSA_URLS[config.env].webserv, body, 'urn:DinaPaq-WebServService#GrabaEnvio24')
    return parseGrabaEnvioResponse(xml)
  })
}

/**
 * Descarga etiqueta de envio.
 */
export async function fetchLabel(
  config: TipsaConfig,
  albaran: string,
  format: TipsaLabelFormat = 'pdf',
): Promise<TipsaLabelResult> {
  return withSession(config, async (session) => {
    const body = buildConsEtiquetaEnvelope({
      creds: config.credentials,
      sessionId: session.id,
      albaran,
      format,
    })
    const xml = await postSoap(TIPSA_URLS[config.env].webserv, body, 'urn:DinaPaq-WebServService#ConsEtiquetaEnvio6')
    return parseConsEtiquetaResponse(xml, format)
  })
}

/**
 * Consulta estados de un envio.
 */
export async function fetchTracking(
  config: TipsaConfig,
  albaran: string,
): Promise<TipsaTrackingResult> {
  return withSession(config, async (session) => {
    const body = buildConsEnvEstadosEnvelope({
      creds: config.credentials,
      sessionId: session.id,
      albaran,
    })
    const xml = await postSoap(TIPSA_URLS[config.env].webserv, body, 'urn:DinaPaq-WebServService#ConsEnvEstados')
    return parseConsEnvEstadosResponse(xml, albaran)
  })
}

/**
 * Consulta TODOS los cambios de estado ocurridos en la ventana temporal
 * [sinceDate, untilDate] con paginacion automatica. 1 sola llamada global
 * en lugar de 1 por albaran — ideal para el cron de refresh masivo.
 *
 * Recorre todas las paginas hasta agotar (o hasta `maxPages` como salvavidas
 * para no colgarse si TIPSA devuelve mal el iTotalPaginasOut).
 */
export async function fetchTrackingDeltas(
  config: TipsaConfig,
  sinceDate: string,
  untilDate: string,
  maxPages = 50,
): Promise<TipsaTrackingDelta[]> {
  return withSession(config, async (session) => {
    const all: TipsaTrackingDelta[] = []
    let page = 0
    while (page < maxPages) {
      const body = buildConsEnvEstIncCambiosEstadosEnvelope({
        sessionId: session.id,
        sinceDate,
        untilDate,
        page,
      })
      const xml = await postSoap(
        TIPSA_URLS[config.env].webserv,
        body,
        'urn:DinaPaq-WebServService#ConsEnvEstIncCambiosEstados',
      )
      const parsed = parseConsEnvEstIncCambiosEstadosResponse(xml, page)
      all.push(...parsed.deltas)
      if (!parsed.hasMore) break
      page += 1
    }
    return all
  })
}

// =========================================================
// Recogidas
// =========================================================

/**
 * Da de alta una recogida (GrabaRecogida). Si TIPSA la rechaza llega un SOAP
 * Fault "codigo: descripcion" (p. ej. "12: El cliente no autoriza recogidas
 * a su cargo"), que postSoap convierte en Error con ese texto.
 */
export async function createPickup(
  config: TipsaConfig,
  input: TipsaCreatePickupInput,
): Promise<TipsaCreatePickupResult> {
  return withSession(config, async (session) => {
    const body = buildGrabaRecogidaEnvelope({
      creds: config.credentials,
      sessionId: session.id,
      input,
    })
    const xml = await postSoap(
      TIPSA_URLS[config.env].webserv,
      body,
      `urn:DinaPaq-WebServService#${GRABA_RECOGIDA_METHOD}`,
    )
    return parseGrabaRecogidaResponse(xml)
  })
}

/** Historial de estados de una recogida (ConsRecEstados). */
export async function fetchPickupEvents(
  config: TipsaConfig,
  code: string,
): Promise<TipsaShippingEvent[]> {
  return withSession(config, async (session) => {
    const xml = await postSoap(
      TIPSA_URLS[config.env].webserv,
      buildConsRecEstadosEnvelope(session.id, code),
      'urn:DinaPaq-WebServService#ConsRecEstados',
    )
    return parseConsRecEstadosResponse(xml)
  })
}

/** Datos generales de una recogida, incluido el albaran generado (ConsRecogida). */
export async function fetchPickupInfo(
  config: TipsaConfig,
  code: string,
): Promise<TipsaPickupInfo> {
  return withSession(config, async (session) => {
    const xml = await postSoap(
      TIPSA_URLS[config.env].webserv,
      buildConsRecogidaEnvelope(session.id, code),
      'urn:DinaPaq-WebServService#ConsRecogida',
    )
    return parseConsRecogidaResponse(xml)
  })
}

/** Incidencias de una recogida (ConsRecIncidencias). */
export async function fetchPickupIncidences(
  config: TipsaConfig,
  code: string,
): Promise<TipsaPickupIncidence[]> {
  return withSession(config, async (session) => {
    const xml = await postSoap(
      TIPSA_URLS[config.env].webserv,
      buildConsRecIncidenciasEnvelope(session.id, code),
      'urn:DinaPaq-WebServService#ConsRecIncidencias',
    )
    return parseConsRecIncidenciasResponse(xml)
  })
}

/** Anula una recogida en TIPSA (BorraRecogida). Lanza Error si TIPSA no la borra. */
export async function cancelPickup(config: TipsaConfig, code: string): Promise<void> {
  return withSession(config, async (session) => {
    const xml = await postSoap(
      TIPSA_URLS[config.env].webserv,
      buildBorraRecogidaEnvelope(session.id, code),
      'urn:DinaPaq-WebServService#BorraRecogida',
    )
    const { errorCode } = parseBorraRecogidaResponse(xml)
    if (errorCode) {
      const err = new Error(
        BORRA_RECOGIDA_ERRORS[errorCode] ??
          `TIPSA no ha anulado la recogida (código ${errorCode}). Si la agencia de origen ya la ha leído, hay que llamar a esa agencia.`,
      ) as Error & { rawResponse: string }
      err.rawResponse = xml
      throw err
    }
  })
}

// =========================================================
// HTTP POST SOAP
// =========================================================

async function postSoap(url: string, body: string, soapAction: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${soapAction}"`,
      'User-Agent': 'qamarero-tipsa-client/1.0',
      Accept: '*/*',
    },
    body,
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(
      `TIPSA HTTP ${res.status} ${res.statusText} on ${soapAction}`,
    ) as Error & { httpStatus: number; rawResponse: string }
    err.httpStatus = res.status
    err.rawResponse = text
    throw err
  }
  // Detectar SOAP Fault ([\w-]+ para cubrir prefijos con guion como SOAP-ENV)
  if (/<([\w-]+:)?Fault[>\s]/.test(text)) {
    const reason = extractFaultReason(text)
    const err = new Error(
      `TIPSA SOAP Fault on ${soapAction}${reason ? `: ${reason}` : ''}`,
    ) as Error & { rawResponse: string }
    err.rawResponse = text
    throw err
  }
  return text
}

/**
 * Extrae el texto humano del SOAP Fault. TIPSA usa faultstring o faultcode.
 */
function extractFaultReason(xml: string): string {
  const faultstring = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]
  if (faultstring) return decodeEntities(faultstring.trim())
  const faultcode = xml.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i)?.[1]
  if (faultcode) return decodeEntities(faultcode.trim())
  const reason = xml.match(/<(?:[\w-]+:)?Reason[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Reason>/i)?.[1]
  if (reason) return decodeEntities(reason.trim())
  return ''
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
