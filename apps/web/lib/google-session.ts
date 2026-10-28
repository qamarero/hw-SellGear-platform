// =============================================================
// Sesión válida en MainOperation: solo Google, solo @qamarero.com, 7 días.
// La misma regla está en la BD (public.mo_google_session) con 1 h de margen.
// =============================================================

export const ALLOWED_EMAIL = /^[a-z0-9._%+-]+@qamarero\.com$/

/**
 * Cada 7 días hay que volver a pasar por Google: renovar la sesión no vuelve a
 * preguntar a Google, entrar sí. Quien sale del Workspace se queda fuera como
 * mucho en una semana.
 */
export const GOOGLE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type GoogleSessionStatus = 'valid' | 'expired' | 'invalid'

/** Claims del JWT de Supabase (`getClaims()`): `email` y `amr` (cómo y cuándo se entró). */
export function googleSessionStatus(
  claims: { email?: unknown; amr?: unknown } | null | undefined,
  now = Date.now()
): GoogleSessionStatus {
  const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : ''
  if (!ALLOWED_EMAIL.test(email)) return 'invalid'
  const signIns = (Array.isArray(claims?.amr) ? claims.amr : [])
    .filter((m) => (m as { method?: unknown } | null)?.method === 'oauth')
    .map((m) => (m as { timestamp?: unknown }).timestamp)
    .filter((t): t is number => typeof t === 'number')
  if (signIns.length === 0) return 'invalid'
  return Math.max(...signIns) * 1000 >= now - GOOGLE_SESSION_MAX_AGE_MS ? 'valid' : 'expired'
}

/** Destino tras el login: solo rutas internas, nunca otro dominio (`//x`, `/\x`, `@x`). */
export function safeNextPath(value: string | null | undefined, fallback = '/orders') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  try {
    const url = new URL(value, 'https://mainops.invalid')
    return url.origin === 'https://mainops.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch {
    return fallback
  }
}
