/**
 * Aviso a HSM de los cambios de estado de una recogida que nacio alli.
 * Webhook: POST {HSM_BASE_URL}/api/webhooks/mainops/pickups con X-API-Key.
 *
 * Nunca lanza: devuelve ok/false y el llamante decide. Si HSM no contesta 2xx,
 * hsm_notified_status se queda atras y el cron lo reintenta en la siguiente
 * pasada (syncPickupWithHsm en ./service.ts).
 */
import type { PickupDTO } from './dto'

export type HsmNotifyResult =
  | { ok: true }
  | { ok: false; reason: string }

export async function notifyHsm(dto: PickupDTO): Promise<HsmNotifyResult> {
  const base = process.env.HSM_BASE_URL
  const key = process.env.HSM_WEBHOOK_KEY
  if (!base || !key) {
    return { ok: false, reason: 'HSM_BASE_URL o HSM_WEBHOOK_KEY sin configurar' }
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/webhooks/mainops/pickups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify({ event: 'pickup.status_changed', pickup: dto }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return { ok: false, reason: `HSM respondio ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}
