import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildOrderSearchOr } from '@/lib/orders/search'
import { generateCSV } from '@/lib/metrics'
import type { UserRole, OrderStatus, PurchaseType } from '@/types/database'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'hardware']

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const type = searchParams.get('type')

  let query = supabase
    .from('orders')
    .select('operation_id, created_at, customer_name, venue_name, purchase_type, amount, status, supplier, invoiced, requester_name, order_items(product_name, qty)')
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status as OrderStatus)
  }

  if (type) {
    query = query.eq('purchase_type', type as PurchaseType)
  }

  if (search) {
    const or = buildOrderSearchOr(search)
    if (or) query = query.or(or)
  }

  const { data: orders, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (orders || []).map((o) => ({
    operation_id: o.operation_id,
    created_at: o.created_at,
    customer_name: o.customer_name,
    venue_name: o.venue_name,
    purchase_type: o.purchase_type,
    amount: o.amount,
    status: o.status,
    supplier: o.supplier,
    invoiced: o.invoiced,
    requester_name: o.requester_name,
    products: (o.order_items || [])
      .map((i: { product_name: string; qty: number }) => `${i.product_name} x${i.qty}`)
      .join('; '),
  }))

  const csv = generateCSV(rows, { includeExtended: true })
  const today = new Date().toISOString().slice(0, 10)
  const filename = `pedidos_export_${today}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
