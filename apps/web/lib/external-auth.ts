import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Valida el header `X-API-Key` contra la env var indicada (default
 * `MAIN_PORTAL_API_KEY`). Comparación con timingSafeEqual para mitigar
 * timing attacks.
 *
 * Reusable para futuros endpoints de integración server-to-server.
 * Para endpoints con scope distinto, pasar otra env var (ej. `HWTOOLBOX_API_KEY`).
 */
export function validateApiKey(
  request: NextRequest,
  envVarName: string = 'MAIN_PORTAL_API_KEY',
  { allowQarvis = true }: { allowQarvis?: boolean } = {},
):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  // Claves válidas: la específica del endpoint (envVarName) MÁS una clave
  // compartida opcional para Qarvis (el cerebro del ecosistema, solo lectura).
  // Añadir QARVIS_API_KEY no altera las claves de los demás consumidores
  // (Portal, HWToolbox): solo AMPLÍA el conjunto aceptado, de forma
  // retro-compatible. Si QARVIS_API_KEY no está definida, el comportamiento es
  // idéntico al anterior.
  // Los endpoints que ESCRIBEN (recogidas de HSM) pasan allowQarvis: false:
  // Qarvis es de solo lectura y su clave no debe poder crear nada.
  const candidates = [
    process.env[envVarName],
    allowQarvis ? process.env.QARVIS_API_KEY : undefined,
  ].filter((k): k is string => typeof k === 'string' && k.length > 0)

  // Config inválida — la app no está lista para servir este endpoint.
  if (candidates.length === 0) {
    console.error(`[external-auth] ${envVarName} (ni QARVIS_API_KEY) configurada`)
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Endpoint no disponible (config)' },
        { status: 503 },
      ),
    }
  }

  const provided = request.headers.get('x-api-key') ?? ''
  if (!provided) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Falta X-API-Key' },
        { status: 401 },
      ),
    }
  }

  // timingSafeEqual requiere buffers del mismo tamaño. Si difieren, hacemos una
  // comparación dummy para no filtrar longitud. Se acepta si coincide con
  // CUALQUIERA de las claves válidas.
  const providedBuf = Buffer.from(provided, 'utf8')
  let match = false
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate, 'utf8')
    if (providedBuf.length === candidateBuf.length) {
      if (timingSafeEqual(providedBuf, candidateBuf)) {
        match = true
        break
      }
    } else {
      // Comparación dummy para mantener tiempo ~constante.
      timingSafeEqual(candidateBuf, candidateBuf)
    }
  }

  if (!match) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'API key inválida' },
        { status: 403 },
      ),
    }
  }

  return { ok: true }
}
