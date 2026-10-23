import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTipsaConfig } from '@/lib/tipsa/services'
import { refreshPickup } from '@/lib/pickups/service'
import { loadPickup, requirePickupManager, tipsaErrorMessage } from '@/lib/pickups/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/pickups/[id]/refresh — boton «Actualizar» de la ficha. */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const auth = await requirePickupManager()
  if (!auth.ok) return auth.response
  const { id } = await params

  const admin = createAdminClient()
  const loaded = await loadPickup(admin, id)
  if (!loaded.ok) return loaded.response
  if (!loaded.pickup.tipsa_code) {
    return NextResponse.json({ error: 'Aún no está programada en TIPSA.' }, { status: 409 })
  }

  try {
    const pickup = await refreshPickup(admin, loadTipsaConfig(), loaded.pickup)
    return NextResponse.json({ pickup })
  } catch (err) {
    return NextResponse.json({ error: `TIPSA: ${tipsaErrorMessage(err)}` }, { status: 502 })
  }
}
