import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateApiKey } from '@/lib/external-auth'
import { PICKUP_SELECT, buildDTO, cancelPickupFlow } from '@/lib/pickups/service'
import type { Pickup } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/external/hsm/pickups/{pickup_id}/cancel
 *
 * HSM solo puede anular lo que aun no se ha mandado a TIPSA. Programada o mas
 * alla, la anulacion la hace logistica desde MainOps: implica borrarla en
 * TIPSA y alguien tiene que mirar que el repartidor no este ya en camino.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pickupId: string }> },
) {
  const auth = validateApiKey(request, 'HSM_API_KEY', { allowQarvis: false })
  if (!auth.ok) return auth.response

  const { pickupId } = await params

  let reason: string | null = null
  try {
    const body = (await request.json()) as { reason?: unknown }
    reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  } catch {
    // Body opcional.
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pickups')
    .select(PICKUP_SELECT)
    .eq('pickup_id', pickupId)
    .eq('source', 'hsm')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Recogida no encontrada' }, { status: 404 })

  const pickup = data as Pickup
  if (pickup.status !== 'solicitada' && pickup.status !== 'anulada') {
    return NextResponse.json(
      { error: 'Ya está programada: pide a logística que la anule desde MainOps.', pickup: await buildDTO(admin, pickup) },
      { status: 409 },
    )
  }

  try {
    const cancelled = await cancelPickupFlow(admin, null, pickup, reason, null, 'hsm')
    return NextResponse.json({ pickup: await buildDTO(admin, cancelled) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
