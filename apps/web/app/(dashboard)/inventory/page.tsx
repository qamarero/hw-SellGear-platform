import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createInventoryClient } from '@/lib/supabase/inventory'
import type { UserRole } from '@/types/database'
import { getCatalog } from '@/lib/catalog/queries'
import { getStockSnapshot, toStockView } from '@/lib/stock/server'
import {
  ENVIADO_RESERVE_DAYS,
  isStockControlled,
  productAvailable,
} from '@/lib/stock/compute'

export const dynamic = 'force-dynamic'

// Solo internos. viewer no entra (ni siquiera ve el item en el sidebar).
const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'hardware', 'commercial']

/**
 * Tipos de HWToolbox que no son producto vendible: no cuentan en el total
 * de stock (antes 247 sobres y cajas inflaban "452 unidades").
 */
const NON_PRODUCT_TYPES = new Set(['Embalaje'])

interface InventoryRow {
  tipo_articulo: string
  total_unidades_nuevas: number
}

interface RawRow {
  tipo_articulo: string
  total_unidades_nuevas: number | string // BIGINT puede venir como string
}

export default async function InventoryPage() {
  // 1. Auth contra el proyecto PRINCIPAL (sesión usuario, cookies).
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  // 2. Role check (también en el proyecto principal).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect('/')
  }

  // 3. Datos: cliente secundario apuntando al proyecto de inventario
  //    (olcxbtvjkjmofrbvzpat) con service_role key. Si las envs no están
  //    configuradas en Vercel, mostramos un mensaje útil al admin en vez
  //    de crashear.
  const inventoryClient = createInventoryClient()

  let rows: InventoryRow[] = []
  let total = 0
  let errorMessage: string | null = null
  let configError = false

  if (!inventoryClient) {
    configError = true
    errorMessage =
      'Inventario no configurado: faltan las variables de entorno ' +
      'INVENTORY_SUPABASE_URL y/o INVENTORY_SUPABASE_SERVICE_KEY en Vercel.'
  } else {
    const { data: rawRows, error } = await inventoryClient.rpc(
      'get_inventory_by_type',
    )
    if (error) {
      errorMessage = `Error al cargar el inventario: ${error.message}`
    } else {
      rows = ((rawRows as RawRow[] | null) ?? []).map((r) => ({
        tipo_articulo: r.tipo_articulo,
        total_unidades_nuevas: Number(r.total_unidades_nuevas),
      }))
      total = rows
        .filter((r) => !NON_PRODUCT_TYPES.has(r.tipo_articulo))
        .reduce((acc, r) => acc + r.total_unidades_nuevas, 0)
    }
  }
  const tiposCount = rows.filter((r) => !NON_PRODUCT_TYPES.has(r.tipo_articulo)).length

  // Stock pedible: lo que de verdad se puede vender (disponible − comprometido
  // en pedidos de MainOps aún no descontados en HWToolbox). Ver lib/stock.
  const [snapshot, catalog] = await Promise.all([getStockSnapshot(), getCatalog()])
  const view = toStockView(snapshot, false)
  const productRows = catalog
    .filter((p) => isStockControlled(p))
    .map((p) => ({
      product: p,
      mapped: (view.components[p.code] ?? []).length > 0,
      orderable: productAvailable(p, view),
    }))

  return (
    <div className="px-6 py-8">
      {/* Header — left-aligned (patrón de /orders y /metrics) */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
        <p className="mt-1 text-sm text-gray-500">
          Unidades nuevas disponibles agrupadas por tipo de artículo.
        </p>
      </div>

      {/* Zona de contenido centrada y acotada para no estirar la tabla
          a lo ancho. max-w-3xl (~768px) deja espacio suficiente para
          el KPI hero (3 cols) y mantiene la tabla compacta. */}
      <div className="mx-auto max-w-3xl">
        {/* KPI hero — siempre visible, muestra 0 si no hay datos */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-gray-500">
              Stock total nuevo disponible
            </p>
            <p className="mt-2 font-mono text-3xl font-bold text-gray-900">{total}</p>
            <p className="mt-1 text-xs text-gray-400">
              {tiposCount} tipo{tiposCount === 1 ? '' : 's'} de artículo · sin embalaje
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-gray-500">
              Comprometido en pedidos
            </p>
            <p className="mt-2 font-mono text-3xl font-bold text-gray-900">
              {snapshot.pools.reduce((acc, p) => acc + p.committed, 0)}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              vendido y aún sin salida en HWToolbox
            </p>
          </div>
          {/* Hueco intencionado en el grid para futuras métricas. */}
        </div>

        {snapshot.status !== 'ok' && (
          <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            No se ha podido calcular el stock pedible, así que ahora mismo solo
            los admins pueden pedir productos con control de stock.
            {snapshot.reason && (
              <span className="mt-1 block font-mono text-xs">{snapshot.reason}</span>
            )}
          </div>
        )}

        {/* Stock pedible por producto del catálogo */}
        {snapshot.status === 'ok' && (
          <section className="mb-8">
            <h2 className="text-base font-semibold text-gray-900">
              Stock pedible por producto
            </h2>
            <p className="mt-1 mb-3 text-xs text-gray-500">
              Lo que un comercial puede pedir ahora: disponible en HWToolbox menos
              lo vendido en pedidos que aún no tienen salida registrada. Los
              admins pueden pedir por encima.
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Producto
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Pedible
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {productRows.map(({ product, mapped, orderable }) => (
                    <tr key={product.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm text-gray-900">
                        {product.name}
                        {!mapped && (
                          <span className="ml-2 text-xs text-gray-500">
                            sin artículo en HWToolbox
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${
                          orderable <= 0
                            ? 'text-red-600'
                            : orderable <= 5
                              ? 'text-amber-700'
                              : 'text-gray-900'
                        }`}
                      >
                        {orderable}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pedidos enviados cuya salida falta en HWToolbox */}
        {snapshot.status === 'ok' && snapshot.pendingExits.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-semibold text-gray-900">
              Enviados con salida pendiente en HWToolbox
            </h2>
            <p className="mt-1 mb-3 text-xs text-gray-500">
              Siguen reservando stock hasta que se registre su transacción de
              salida (o pasen {ENVIADO_RESERVE_DAYS} días desde el envío).
            </p>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {snapshot.pendingExits.map((p) => (
                <li
                  key={p.operation_id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-mono text-gray-900">{p.operation_id}</span>
                  <span className="text-gray-600">
                    {p.units} unidad{p.units === 1 ? '' : 'es'} sin registrar
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Detalle por grupo de artículos (pools) */}
        {snapshot.status === 'ok' && snapshot.pools.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-semibold text-gray-900">
              Detalle por grupo de artículos
            </h2>
            <p className="mt-1 mb-3 text-xs text-gray-500">
              Cada grupo junta los modelos de HWToolbox intercambiables entre sí
              (tabla stock_pools).
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Grupo
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Disponible
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Comprometido
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Pedible
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {snapshot.pools.map((p) => (
                    <tr key={p.key} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm text-gray-900">{p.label}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-gray-700">
                        {p.available}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-gray-700">
                        {p.committed}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${
                          p.orderable <= 0 ? 'text-red-600' : 'text-gray-900'
                        }`}
                      >
                        {p.orderable}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Unidades nuevas por tipo (HWToolbox)
        </h2>

        {/* Tabla / estados */}
        {errorMessage ? (
          <div
            className={
              configError
                ? 'rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200'
                : 'rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200'
            }
          >
            {errorMessage}
          </div>
        ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="mb-4 h-12 w-12 text-gray-300"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-500">
            No hay unidades disponibles
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Cuando lleguen nuevas unidades nuevas aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Tipo de artículo
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Unidades nuevas
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr
                  key={row.tipo_articulo}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {row.tipo_articulo}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-gray-900">
                    {row.total_unidades_nuevas}
                  </td>
                </tr>
              ))}
              {/* Fila Total — coherente con el patrón thead (bg-gray-50 +
                  uppercase tracking-wider + text-gray-500) pero el número
                  en font-bold para destacar el agregado. */}
              <tr className="bg-gray-50">
                <td className="px-4 py-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Total <span className="normal-case tracking-normal">(sin embalaje)</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm font-bold text-gray-900">
                  {total}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  )
}
