import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTipsaConfig } from '@/lib/tipsa/services'
import { PickupConflictError, cancelPickupFlow } from '@/lib/pickups/service'
import { loadPickup, requirePickupManager, tipsaErrorMessage } from '@/lib/pickups/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/pickups/[id]/cancel — anula la recogida. Si ya estaba en TIPSA,
 * la borra alli (BorraRecogida); si TIPSA no la borra, aqui no se anula.
 * Body opcional { reason }.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requirePickupManager()
  if (!auth.ok) return auth.response
  const { id } = await params

  let reason: string | null = null
  try {
    const body = (await request.json()) as { reason?: unknown }
    reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  } catch {
    // Body opcional.
  }

  const admin = createAdminClient()
  const loaded = await loadPickup(admin, id)
  if (!loaded.ok) return loaded.response

  let config = null
  if (loaded.pickup.tipsa_code) {
    try {
      config = loadTipsaConfig()
    } catch (err) {
      return NextResponse.json({ error: 'TIPSA no configurada', detail: (err as Error).message }, { status: 500 })
    }
  }

  try {
    const pickup = await cancelPickupFlow(admin, config, loaded.pickup, reason, auth.userId, 'mainops')
    return NextResponse.json({ pickup })
  } catch (err) {
    if (err instanceof PickupConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: `TIPSA: ${tipsaErrorMessage(err)}` }, { status: 502 })
  }
}
