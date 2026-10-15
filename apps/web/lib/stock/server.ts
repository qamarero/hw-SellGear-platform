// =============================================================
// Control de stock: carga de datos. SOLO servidor.
//
// Junta los dos proyectos Supabase:
//   principal   stock_pools, product_stock_components y
//               get_stock_commitments() (lo vendido y no descontado);
//   inventario  get_stock_by_article() y get_mainops_exits() (HWToolbox).
// El cálculo es puro y vive en ./compute.ts.
//
// Cualquier fallo de lectura deja la foto en status 'unavailable', que para
// un no-admin bloquea los productos con control de stock: mejor parar una
// venta que vender a ciegas. Los admins siguen pidiendo.
// =============================================================

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInventoryClient } from '@/lib/supabase/inventory'
import { isAdminUser } from '@/lib/auth'
import type { UserRole } from '@/types/database'
import {
  ENVIADO_RESERVE_DAYS,
  componentsByCode,
  computePools,
  type CommitmentRow,
  type ComponentRow,
  type ExitRow,
  type PendingExit,
  type PoolDef,
  type PoolStock,
  type StockComponent,
  type StockView,
} from './compute'

export interface StockSnapshot {
  status: 'ok' | 'unavailable'
  /** Por qué no se pudo leer, para la página de stock. */
  reason: string | null
  pools: PoolStock[]
  components: Record<string, StockComponent[]>
  pendingExits: PendingExit[]
}

function unavailable(
  reason: string,
  partial: Partial<StockSnapshot> = {},
): StockSnapshot {
  console.error(`[stock] ${reason}`)
  return {
    status: 'unavailable',
    reason,
    pools: partial.pools ?? [],
    components: partial.components ?? {},
    pendingExits: partial.pendingExits ?? [],
  }
}

/**
 * Foto del stock en este momento. Sin caché: los route handlers que crean
 * pedidos la necesitan fresca (y la vuelven a pedir tras insertar, para
 * detectar dos pedidos simultáneos por la última unidad).
 *
 * NUNCA lanza: la llaman /api/products y el layout de /catalogo, y un fallo
 * del stock no puede dejar al wizard sin catálogo. Cualquier excepción
 * (p.ej. falta SUPABASE_SERVICE_ROLE_KEY, que hace lanzar a
 * createAdminClient) se convierte en 'unavailable'.
 */
export async function loadStockSnapshot(): Promise<StockSnapshot> {
  try {
    return await readStockSnapshot()
  } catch (err) {
    return unavailable(
      `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function readStockSnapshot(): Promise<StockSnapshot> {
  const admin = createAdminClient()

  const [poolsRes, compsRes, commitsRes] = await Promise.all([
    admin.from('stock_pools').select('key, label, article_ids'),
    admin.from('product_stock_components').select('product_code, pool_key, quantity'),
    admin.rpc('get_stock_commitments', { p_enviado_dias: ENVIADO_RESERVE_DAYS }),
  ])
  if (poolsRes.error || compsRes.error || commitsRes.error) {
    return unavailable(
      `MainOps: ${(poolsRes.error ?? compsRes.error ?? commitsRes.error)!.message}`,
    )
  }
  const pools = (poolsRes.data ?? []) as PoolDef[]
  const components = (compsRes.data ?? []) as ComponentRow[]
  const commitments = (commitsRes.data ?? []) as CommitmentRow[]

  const inventory = createInventoryClient()
  if (!inventory) {
    return unavailable(
      'Inventario no configurado: faltan INVENTORY_SUPABASE_URL / INVENTORY_SUPABASE_SERVICE_KEY.',
      { components: componentsByCode(components) },
    )
  }

  const operationIds = [...new Set(commitments.map((c) => c.operation_id))]
  const [stockRes, exitsRes] = await Promise.all([
    inventory.rpc('get_stock_by_article'),
    operationIds.length
      ? inventory.rpc('get_mainops_exits', { p_operation_ids: operationIds })
      : Promise.resolve({ data: [] as ExitRow[], error: null }),
  ])
  if (stockRes.error || exitsRes.error) {
    return unavailable(
      `Inventario: ${(stockRes.error ?? exitsRes.error)!.message}`,
      { components: componentsByCode(components) },
    )
  }

  const availableByArticle = new Map<string, number>()
  for (const row of (stockRes.data ?? []) as { article_id: string; disponibles_nuevos: number | string }[]) {
    availableByArticle.set(row.article_id, Number(row.disponibles_nuevos))
  }

  const result = computePools({
    pools,
    components,
    availableByArticle,
    commitments,
    exits: (exitsRes.data ?? []) as ExitRow[],
  })
  return { status: 'ok', reason: null, ...result }
}

/**
 * La misma foto, compartida entre el layout y la página de un mismo render
 * de servidor. Solo para Server Components: en route handlers usa
 * loadStockSnapshot, que siempre lee de nuevo.
 */
export const getStockSnapshot = cache(loadStockSnapshot)

export function toStockView(snapshot: StockSnapshot, bypass: boolean): StockView {
  return {
    status: snapshot.status,
    bypass,
    pools: Object.fromEntries(snapshot.pools.map((p) => [p.key, p.orderable])),
    components: snapshot.components,
  }
}

/** Admins: piden sin tope. Misma definición que la ficha del pedido. */
export function canBypassStock(
  email: string | null | undefined,
  role: UserRole | null | undefined,
): boolean {
  return isAdminUser(email, role)
}
