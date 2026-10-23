import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTipsaConfig } from '@/lib/tipsa/services'
import { todayInMadrid, validateScheduleBody } from '@/lib/pickups/validate'
import { schedulePickup } from '@/lib/pickups/service'
import { loadPickup, requirePickupManager, tipsaErrorMessage } from '@/lib/pickups/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/pickups/[id]/schedule — da de alta la recogida en TIPSA
 * (GrabaRecogida) con la fecha, franja, bultos y peso que elige logistica.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requirePickupManager()
  if (!auth.ok) return auth.response
  const { id } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  const validation = validateScheduleBody(raw, todayInMadrid())
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, field: validation.field }, { status: 400 })
  }

  const admin = createAdminClient()
  const loaded = await loadPickup(admin, id)
  if (!loaded.ok) return loaded.response
  if (loaded.pickup.status !== 'solicitada') {
    return NextResponse.json(
      { error: loaded.pickup.tipsa_code ? `Ya está programada en TIPSA (${loaded.pickup.tipsa_code}).` : 'Esta recogida ya no se puede programar.' },
      { status: 409 },
    )
  }

  let config
  try {
    config = loadTipsaConfig()
  } catch (err) {
    return NextResponse.json({ error: 'TIPSA no configurada', detail: (err as Error).message }, { status: 500 })
  }

  try {
    const pickup = await schedulePickup(admin, config, loaded.pickup, validation.data, auth.userId)
    return NextResponse.json({ pickup })
  } catch (err) {
    console.error('[pickups/schedule]', (err as Error).message)
    return NextResponse.json({ error: `TIPSA: ${tipsaErrorMessage(err)}` }, { status: 502 })
  }
}
