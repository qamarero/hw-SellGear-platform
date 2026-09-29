import { createClient } from '@/lib/supabase/server'
import { buildOrderSearchOr } from '@/lib/orders/search'
import { Suspense } from 'react'
import Link from 'next/link'
import type { Order, OrderStatus, PurchaseType, UserRole } from '@/types/database'
import OrdersTable from '@/components/orders/OrdersTable'
import StatusFilter from '@/components/orders/StatusFilter'
import ShippingOriginFilter from '@/components/orders/ShippingOriginFilter'
import SearchBar from '@/components/orders/SearchBar'
import ExportCSVButton from '@/components/shared/ExportCSVButton'

interface SearchParams {
  status?: string
  search?: string
  type?: string
  shipping?: string
  page?: string
}

const PER_PAGE = 50

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // Get current user role
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let userRole: UserRole | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    userRole = (profile?.role as UserRole) ?? null
  }

  // Paginacion server-side: ?page=N (default 1). 50 filas por pagina.
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  // SELECT acotado para evitar statement timeout:
  //   - sin SELECT * (40+ columnas innecesarias),
  //   - sin order_items embebido (lazy-load en el popup vía
  //     GET /api/orders/[id]/items),
  //   - count 'planned' (estimación instantánea con pg_class.reltuples)
  //     en vez de 'exact' (full table scan secundario).
  // order_payments(installment_no, status) se mantiene: max 3 filas por
  // pedido, lo usa el FinancingProgressBadge inline en la tabla.
  let query = supabase
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
      { count: 'planned' },
    )
    .order('created_at', { ascending: false })

  if (params.status) {
    query = query.eq('status', params.status as OrderStatus)
  }

  if (params.type) {
    query = query.eq('purchase_type', params.type as PurchaseType)
  }

  if (params.shipping) {
    query = query.eq('status', params.shipping as OrderStatus)
  }

  if (params.search) {
    const or = buildOrderSearchOr(params.search)
    if (or) query = query.or(or)
  }

  // Truco N+1: pedimos PER_PAGE+1 filas. Si vuelven PER_PAGE+1, hay siguiente
  // pagina (hasNext=true) y descartamos la fila extra antes de renderizar.
  // Asi no dependemos del count 'planned' (que puede quedar desactualizado
  // tras muchos INSERTs sin autovacuum y provocar el "Mostrando 50 de 47").
  const { data: rawRows, error, count } = await query.range(
    offset,
    offset + PER_PAGE, // inclusive → pide PER_PAGE+1 filas
  )
  const hasNext = (rawRows?.length ?? 0) > PER_PAGE
  const orders = hasNext ? (rawRows ?? []).slice(0, PER_PAGE) : (rawRows ?? [])
  const total = count ?? 0

  return (
    <div className="px-6 py-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="mt-1 text-sm text-gray-500">
            {(() => {
              const visible = orders?.length ?? 0
              const filtered = !!(params.status || params.search || params.type)
              // Si estamos en pagina 1 y no hay siguiente, es el conteo real:
              // "N pedidos" (o "encontrados" cuando hay filtros).
              if (page === 1 && !hasNext) {
                return `${visible} pedido${visible !== 1 ? 's' : ''}${filtered ? ' encontrados' : ''}`
              }
              // Con paginacion: no mostramos totales inconsistentes; el user
              // navega con Prev/Next. La cabecera indica en que pagina esta.
              return `Pagina ${page} · Mostrando ${visible} pedidos${hasNext ? ' (hay mas)' : ''}${filtered ? ' encontrados' : ''}`
            })()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {userRole && ['admin', 'manager', 'hardware'].includes(userRole) && (
            <ExportCSVButton
              exportUrl="/api/orders/export"
              params={{
                status: params.status,
                search: params.search,
                type: params.type,
              }}
              label="Exportar CSV"
            />
          )}
          {userRole !== 'viewer' && (
            <Link
              href="/orders/new"
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Nuevo pedido
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Suspense>
          <SearchBar />
        </Suspense>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Suspense>
          <StatusFilter />
        </Suspense>
        <div className="h-6 w-px bg-gray-200" />
        <Suspense>
          <ShippingOriginFilter />
        </Suspense>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Error al cargar pedidos: {error.message}
        </div>
      )}

      {/* Table */}
      <OrdersTable
        // El SELECT acotado devuelve un subset de Order (sin updated_at,
        // created_by, etc. — campos que la lista no usa). OrdersTable solo
        // accede a las columnas pedidas en el SELECT, así que el cast es
        // seguro a runtime; lo hacemos explícito vía unknown para que TS
        // no se queje.
        orders={orders as unknown as Order[]}
        userRole={userRole}
        page={page}
        perPage={PER_PAGE}
        total={total}
        initialHasNext={hasNext}
      />
    </div>
  )
}
