/**
 * Comun a las rutas internas /api/pickups/*: sesion + rol, y cargar la
 * recogida por id.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManagePickups } from '@/lib/auth'
import type { createAdminClient } from '@/lib/supabase/admin'
import { PICKUP_SELECT } from './service'
import type { Pickup, UserRole } from '@/types/database'

export async function requirePickupManager(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
  if (!canManagePickups(profile?.role as UserRole | undefined)) {
    return { ok: false, response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) }
  }
  return { ok: true, userId: user.id }
}

export async function loadPickup(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<{ ok: true; pickup: Pickup } | { ok: false; response: NextResponse }> {
  const { data, error } = await admin.from('pickups').select(PICKUP_SELECT).eq('id', id).maybeSingle()
  if (error) return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) }
  if (!data) return { ok: false, response: NextResponse.json({ error: 'Recogida no encontrada' }, { status: 404 }) }
  return { ok: true, pickup: data as Pickup }
}

/**
 * Mensaje de TIPSA para la persona. Los SOAP Fault de GrabaRecogida llegan
 * como "TIPSA SOAP Fault on urn:...#GrabaRecogida12: 12: El cliente no
 * autoriza recogidas a su cargo": nos quedamos con "12: El cliente...".
 */
export function tipsaErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/SOAP Fault on \S+#\w+:\s*(.+)$/)
  return m ? m[1] : msg
}
