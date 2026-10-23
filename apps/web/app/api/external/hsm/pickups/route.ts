import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateApiKey } from '@/lib/external-auth'
import { validatePickupRequest } from '@/lib/pickups/validate'
import { PICKUP_SELECT, buildDTO, insertPickupRequest } from '@/lib/pickups/service'
import type { Pickup } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recogidas pedidas desde HSM. Contrato:
 * docs/integrations/hsm/RECOGIDAS-CONTRATO.md (secciones 1 y 2).
 *
 * Server-to-server: HSM llama desde sus server actions, asi que no hay CORS.
 * Clave propia HSM_API_KEY y sin la de Qarvis: este endpoint escribe.
 */

// POST — HSM pide la recogida de un RMA. Queda «solicitada» hasta que
// logistica la programa desde /recogidas.
export async function POST(request: NextRequest) {
  const auth = validateApiKey(request, 'HSM_API_KEY', { allowQarvis: false })
  if (!auth.ok) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido', field: 'body' }, { status: 400 })
  }

  const validation = validatePickupRequest(raw, { requireRma: true })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, field: validation.field }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const { pickup, created } = await insertPickupRequest(admin, validation.data, 'hsm', null)
    return NextResponse.json({ pickup: await buildDTO(admin, pickup) }, { status: created ? 201 : 200 })
  } catch (err) {
    console.error('[external/hsm/pickups] POST:', (err as Error).message)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// GET ?rma_id= — para que HSM se resincronice si perdio un webhook.
export async function GET(request: NextRequest) {
  const auth = validateApiKey(request, 'HSM_API_KEY', { allowQarvis: false })
  if (!auth.ok) return auth.response

  const rmaId = new URL(request.url).searchParams.get('rma_id')?.trim()
  if (!rmaId) {
    return NextResponse.json({ error: 'rma_id es obligatorio', field: 'rma_id' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pickups')
    .select(PICKUP_SELECT)
    .eq('source', 'hsm')
    .eq('source_id', rmaId)
    .order('created_at', { ascending: false })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pickups = await Promise.all(((data ?? []) as Pickup[]).map((p) => buildDTO(admin, p)))
  return NextResponse.json({ pickups })
}
