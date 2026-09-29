import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildOrderSearchOr } from '@/lib/orders/search'
import type { Order, OrderStatus, PurchaseType } from '@/types/database'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * GET /api/orders/list
 *
 * Endpoint dedicado al boton "Cargar 50 mas" del listado /orders.
 * Devuelve JSON paginado por (offset, limit), no por page=N.
 * Aplica los mismos filtros que /orders (status, type, shipping, search).
 * RLS filtra automaticamente segun el rol.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const sp = new URL(request.url).searchParams
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const limit = clampInt(sp.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT)

  // SELECT acotado (mismo patrón que /orders/page.tsx): sin SELECT *, sin
  // order_items embebido (lazy-load via GET /api/orders/[id]/items),
  // manteniendo order_payments(installment_no, status) para el
  // FinancingProgressBadge inline.
  let q = supabase
    .from('orders')
    .select(
      `
        id, operation_id, created_at, updated_at, customer_name, venue_name, purchase_type,
        amount, status, supplier, invoiced, requester_name,
        shipping_address, shipping_cp, shipping_label_url,
        contact_email, phone, notes,
        prepared, shipped, delivered_at,
        tracking_number, tracking_public_url,
        order_payments(installment_no, status)
      `,
    )
    .order('created_at', { ascending: false })

  const status = sp.get('status')
  if (status) q = q.eq('status', status as OrderStatus)

  const type = sp.get('type')
  if (type) q = q.eq('purchase_type', type as PurchaseType)

  const shipping = sp.get('shipping')
  if (shipping) q = q.eq('status', shipping as OrderStatus)

  const search = sp.get('search')
  if (search) {
    const or = buildOrderSearchOr(search)
    if (or) q = q.or(or)
  }

  // Truco N+1: pedimos limit+1 filas para saber si hay siguiente pagina
  // sin depender del count 'planned' (que puede quedar desactualizado).
  const { data, error } = await q.range(offset, offset + limit)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const rows = (data ?? []) as Order[]
  const hasNext = rows.length > limit
  const orders = hasNext ? rows.slice(0, limit) : rows

  return NextResponse.json({ orders, hasNext })
}
