import type { TipsaConfig, TipsaEnv, TipsaEventCode } from './types'

/**
 * URLs SOAP de TIPSA por entorno.
 */
export const TIPSA_URLS = {
  test: {
    login: 'https://wsval.tipsa-dinapaq.com/SOAP?service=LoginWSService',
    webserv: 'https://wsval.tipsa-dinapaq.com/SOAP?service=WebServService',
  },
  prod: {
    login: 'https://ws.tipsa-dinapaq.com/SOAP?service=LoginWSService',
    webserv: 'https://ws.tipsa-dinapaq.com/SOAP?service=WebServService',
  },
} as const satisfies Record<TipsaEnv, { login: string; webserv: string }>

/**
 * Catalogo por defecto de servicios TIPSA Dinapaq.
 * Extraido de docs/integrations/tipsa/extracted/Documentacion/Documentacion WebServices 64.0_resumen_ES.pdf.
 * Son todos los codigos disponibles en el contrato QR Payments; TIPSA aplica las
 * restricciones propias de cada codigo (ej. 10h no disponible a Peninsula/Baleares).
 * Si se intenta un codigo no admisible para el destino, TIPSA devuelve error 28.
 *
 * Se puede sobreescribir via env var TIPSA_SERVICES_CATALOG (JSON array).
 */
export const DEFAULT_SERVICES_CATALOG: Array<{ code: string; label: string }> = [
  // Mas habituales primero (el primero es el default del selector)
  { code: '48', label: 'Economy (24h)' },
  // Codigo 49 ("Standard") retirado: TIPSA confirmo que no lo reconoce
  // su plataforma. El estandar 24h se gestiona con el codigo 48.
  { code: '24', label: 'Premium' },
  { code: '14', label: '14 Horas' },
  { code: '10', label: '10 Horas' },
  { code: '12', label: 'Mediodía' },
  { code: '19', label: '19 Horas' },
  // Especificos / menos habituales
  { code: '06', label: 'Aérea/Marítima (Canarias/Baleares)' },
  { code: '20', label: 'En Delegación' },
  { code: '50', label: 'Pickup (Puntos Conveniencia)' },
  { code: '15', label: 'Farma 15' },
  { code: '25', label: 'Farma 25' },
  // Internacional / especiales
  { code: '90', label: 'Int-Express' },
  { code: '91', label: 'Int-Economy' },
  { code: '92', label: 'DPD - Classic' },
  { code: '96', label: 'Marítima' },
  { code: 'MV', label: 'Masivo' },
]

/**
 * Mapeo de codigos de evento TIPSA a etiqueta humana.
 *
 * Fuente: catalogo oficial "Tabla de tipos de estados", pagina 22 de
 * docs/integrations/tipsa/extracted/Documentacion/
 *   Documentacion WebServices 64.0_resumen_ES.pdf
 *
 * Verificado ademas contra la web publica de TIPSA para el albaran 0000012023
 * (09/09/2026): los seis eventos que devuelve la API encajan uno a uno con lo
 * que muestra dinapaqweb —
 *   0 @16:07 Documentado · 1 @16:35 TRANSITO · 4 @01:19 incidencia
 *   ("solicitada en otra direccion") · 2 @08:16 REPARTO · 14 @11:37 DISPONIBLE
 *   · 3 @11:56 ENTREGADO.
 *
 * OJO al leer codigo antiguo: hasta 2026-09-09 este mapa estaba corrido y daba
 * 2 = "Entregado" y 3 = "Incidencia", justo al reves de la realidad (2 es el
 * reparto, 3 la entrega). De ahi venia la logica de "anotacion post-entrega",
 * que era una lectura equivocada de la secuencia normal 2 -> 3.
 *
 * El codigo 18 aparece en produccion pero no esta en la tabla (que es de la
 * v64.0 y el WSDL va por la v74.0): se queda sin etiqueta a proposito.
 * Si aparece un codigo desconocido se devuelve "Estado {code}".
 */
export const TIPSA_EVENT_LABELS: Record<string, string> = {
  '0': 'Documentado',
  '1': 'En tránsito',
  '2': 'En reparto',
  '3': 'Entregado',
  '4': 'Incidencia',
  '5': 'Devuelto',
  '6': 'Falta de expedición',
  '7': 'Recanalizado',
  '9': 'Falta de expedición administrativa',
  '10': 'Destruido',
  '11': 'Recogida',
  '12': 'Leída repartidor',
  '13': 'Leída',
  '14': 'Disponible para recoger',
  '15': 'Entrega parcial',
}

export function tipsaEventLabel(code: TipsaEventCode): string {
  return TIPSA_EVENT_LABELS[code] ?? `Estado ${code}`
}

/**
 * Estados "finales": el envio ya no se mueve mas.
 *
 * 3 ENTREGADO y 5 DEVUELTO cierran el recorrido. El 10 DESTRUIDO tambien es
 * final pero no lo metemos aqui: no lo hemos visto nunca en produccion y
 * preferimos que salga como estado desconocido a asumir de que va.
 */
export const TIPSA_TERMINAL_CODES = new Set<string>(['3', '5'])

export function isTerminalEvent(code: TipsaEventCode): boolean {
  return TIPSA_TERMINAL_CODES.has(code)
}

/** Codigo 4 = INCIDENCIA. Un contratiempo del reparto, no un estado del viaje. */
export const TIPSA_INCIDENCE_CODE = '4'

export function isIncidenceEvent(code: TipsaEventCode): boolean {
  return code === TIPSA_INCIDENCE_CODE
}

/**
 * Tipos de incidencia de RECOGIDAS (V_COD_TIPO_INC de ConsRecIncidencias).
 *
 * Fuente: "Tabla de tipos de incidencia" (misma pagina 22 del PDF resumen
 * v64.0), filas "Recogidas" o "Ambos". Las de solo envios no entran: una
 * recogida no puede tener "mercancia en aduana". Un codigo que no este aqui
 * se muestra tal cual, sin inventarle significado.
 */
export const TIPSA_PICKUP_INCIDENCE_LABELS: Record<string, string> = {
  AS: 'Ausente',
  C: 'Cerrado',
  DI: 'Dirección incorrecta',
  DO: 'Devolver a origen',
  EDT: 'Envío deteriorado',
  EI: 'Embalaje insuficiente',
  EXM: 'Extravío de mercancía',
  FD: 'Faltan datos',
  FL: 'Festivo local',
  MC: 'Mal canalizado',
  NTM: 'No tienen mercancía',
  NTV: 'No tienen valija',
  RC: 'Recogida concertada',
  RT: 'Ruta tarde',
  VMS: 'Vehículo mal solicitado',
}

export function tipsaPickupIncidenceLabel(code: string): string {
  return TIPSA_PICKUP_INCIDENCE_LABELS[code] ?? `Incidencia ${code}`
}

/**
 * Calcula el "estado oficial" del envio entre una lista cronologica de eventos.
 *
 * Regla: si en algun momento llego un evento terminal (3 Entregado /
 * 5 Devuelto) ese es el estado, aunque despues venga cualquier otra cosa. Un
 * envio no se des-entrega, y TIPSA sigue emitiendo lecturas despues de la
 * entrega — vimos un 14 (Disponible) posterior a un 3. Sin esta regla un
 * codigo posterior, catalogado o no, degradaba una entrega confirmada.
 *
 * Sin evento terminal, el estado es simplemente el ultimo evento: incluidas las
 * incidencias (codigo 4), que es justo lo que un AE necesita ver.
 *
 * Devuelve null si la lista esta vacia.
 *
 * Generico: acepta cualquier objeto via funcion `getCode` extractora. Asi sirve
 * tanto para `TipsaShippingEvent` (parser SOAP) como para `ShippingEvent` (DB).
 *
 * Asume que `events` esta ordenado cronologicamente ascendente (del mas antiguo al mas reciente).
 */
export function resolveOfficialStatus<T>(
  events: T[],
  getCode: (e: T) => string,
): T | null {
  if (events.length === 0) return null

  for (let i = events.length - 1; i >= 0; i--) {
    if (TIPSA_TERMINAL_CODES.has(getCode(events[i]))) return events[i]
  }

  return events[events.length - 1]
}

/**
 * Lee TipsaConfig desde process.env.
 * Separa credenciales por entorno para poder flipar sin code deploy.
 */
/**
 * Carga solo el catalogo de servicios desde env (sin requerir credenciales).
 * Util para componentes server que muestran el selector en la UI.
 */
export function loadServicesCatalog(): Array<{ code: string; label: string }> {
  return parseServicesCatalog(process.env.TIPSA_SERVICES_CATALOG)
}

export function loadTipsaConfig(): TipsaConfig {
  const env = (process.env.TIPSA_ENV ?? 'test') as TipsaEnv

  const credentials = env === 'prod'
    ? {
        agencyCode: required('TIPSA_PROD_AGENCY_CODE'),
        clientCode: required('TIPSA_PROD_CLIENT_CODE'),
        password: required('TIPSA_PROD_PASSWORD'),
      }
    : {
        agencyCode: required('TIPSA_TEST_AGENCY_CODE'),
        clientCode: required('TIPSA_TEST_CLIENT_CODE'),
        password: required('TIPSA_TEST_PASSWORD'),
      }

  const sender = {
    name: required('TIPSA_SENDER_NAME'),
    address: required('TIPSA_SENDER_ADDRESS'),
    city: required('TIPSA_SENDER_CITY'),
    cp: required('TIPSA_SENDER_CP'),
    phone: required('TIPSA_SENDER_PHONE'),
  }

  const servicesCatalog = parseServicesCatalog(process.env.TIPSA_SERVICES_CATALOG)

  return { env, credentials, sender, servicesCatalog }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function parseServicesCatalog(raw: string | undefined): Array<{ code: string; label: string }> {
  if (!raw) return DEFAULT_SERVICES_CATALOG
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_SERVICES_CATALOG
    const cleaned = parsed
      .filter((it: unknown): it is { code: unknown; label: unknown } =>
        typeof it === 'object' && it !== null && 'code' in it && 'label' in it,
      )
      .map((it) => ({ code: String(it.code), label: String(it.label) }))
      .filter((it) => it.code.length > 0 && it.label.length > 0)
    return cleaned.length > 0 ? cleaned : DEFAULT_SERVICES_CATALOG
  } catch {
    return DEFAULT_SERVICES_CATALOG
  }
}

/**
 * URL publica de seguimiento TIPSA para un envio.
 * Segun doc oficial "Documentacion Construccion URL" pag. 4:
 *   - GUID sin llaves {}, solo el UUID
 *   - FECHA en formato DD/MM/YYYY (literal, sin URL-encode)
 * Ejemplo esperado: ?servicio=16C85B1E-648B-46BD-87CC-B93792BAAF5E&fecha=21/02/2019
 */
export function buildPublicTrackingUrl(
  trackingBaseUrl: string | null,
  guid: string,
  date: Date,
): string | null {
  if (!trackingBaseUrl) return null
  const cleanGuid = guid.replace(/^\{/, '').replace(/\}$/, '')
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getFullYear())
  const fecha = `${dd}/${mm}/${yyyy}`
  return trackingBaseUrl
    .replace('{GUID}', cleanGuid)
    .replace('{FECHA}', fecha)
}
