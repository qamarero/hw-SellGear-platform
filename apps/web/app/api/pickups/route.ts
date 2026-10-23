import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validatePickupRequest } from '@/lib/pickups/validate'
import { insertPickupRequest } from '@/lib/pickups/service'
import { requirePickupManager } from '@/lib/pickups/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ===========================================
// POST /api/pickups — alta manual (sin RMA de HSM)
// ===========================================
// Queda «solicitada», igual que las de HSM, y se programa con el mismo boton.
export async function POST(request: NextRequest) {
  const auth = await requirePickupManager()
  if (!auth.ok) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }

  const validation = validatePickupRequest(raw, { requireRma: false })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, field: validation.field }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const { pickup } = await insertPickupRequest(admin, validation.data, 'manual', auth.userId)
    return NextResponse.json({ pickup }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
