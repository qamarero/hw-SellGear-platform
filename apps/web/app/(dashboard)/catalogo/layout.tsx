import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CatalogSelectionProvider } from '@/components/catalog/CatalogSelectionProvider'
import { getCatalog } from '@/lib/catalog/queries'
import { canBypassStock, getStockSnapshot, toStockView } from '@/lib/stock/server'
import type { UserRole } from '@/types/database'

export const metadata = {
  title: 'Catálogo de hardware',
}

/**
 * El catálogo es CONSULTA, así que lo ve cualquier rol autenticado —
 * incluido `viewer`. Lo que se restringe es crear el pedido, y eso lo decide
 * CatalogSelectionBar con canCreateOrder.
 *
 * El stock se calcula aquí, en servidor, y la selección lo usa para pintar
 * "Sin stock" / "Quedan N" y no dejar pasar de lo pedible (salvo admins).
 * La selección se traslada al wizard, que lo vuelve a comprobar.
 */
export default async function CatalogoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, products, snapshot] = await Promise.all([
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    getCatalog(),
    getStockSnapshot(),
  ])
  const bypass = canBypassStock(user.email, profile?.role as UserRole | undefined)

  return (
    <CatalogSelectionProvider
      stock={toStockView(snapshot, bypass)}
      catalog={products.map(({ code, category, name, supplier_fallback }) => ({
        code,
        category,
        name,
        supplier_fallback,
      }))}
    >
      {children}
    </CatalogSelectionProvider>
  )
}
