import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateApiKey } from '@/lib/external-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Catálogo interno completo para el conector de Qamarero, sin operaciones de escritura. */
export async function GET(request: NextRequest) {
  const auth = validateApiKey(request, 'QARVIS_API_KEY')
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const code = params.get('code')?.trim()
  const active = params.get('active')
  const limitRaw = params.get('limit')
  const offsetRaw = params.get('offset')

  if (active && active !== 'true' && active !== 'false') {
    return NextResponse.json({ error: 'active debe ser true o false' }, { status: 400 })
  }
  if (code && (code.length > 100 || !/^[a-z0-9-]+$/.test(code))) {
    return NextResponse.json({ error: 'code inválido' }, { status: 400 })
  }
  if (limitRaw && !/^\d+$/.test(limitRaw)) {
    return NextResponse.json({ error: 'limit inválido' }, { status: 400 })
  }
  if (offsetRaw && !/^\d+$/.test(offsetRaw)) {
    return NextResponse.json({ error: 'offset inválido' }, { status: 400 })
  }

  const limit = Math.min(Number(limitRaw ?? 100), 100)
  const offset = Number(offsetRaw ?? 0)
  if (limit < 1 || !Number.isSafeInteger(offset) || offset > 100_000) {
    return NextResponse.json({ error: 'Paginación inválida' }, { status: 400 })
  }

  let query = createAdminClient()
    .from('products')
    .select('*', { count: 'exact' })
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true })
    .range(offset, offset + limit - 1)

  if (code) query = query.eq('code', code)
  if (active) query = query.eq('active', active === 'true')

  const { data, error, count } = await query
  if (error) {
    console.error('[external/catalog/products] query error:', error.message)
    return NextResponse.json({ error: 'Error consultando el catálogo' }, { status: 502 })
  }

  const response = NextResponse.json({
    generated_at: new Date().toISOString(),
    pagination: { total: count ?? 0, limit, offset },
    products: data ?? [],
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
