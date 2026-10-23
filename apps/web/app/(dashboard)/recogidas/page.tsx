import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Pickup, UserRole } from '@/types/database'
import { canManagePickups, canReadFreeShipments } from '@/lib/auth'
import { loadServicesCatalog } from '@/lib/tipsa/services'
import { nextWorkingDay } from '@/lib/pickups/format'
import { todayInMadrid } from '@/lib/pickups/validate'
import PickupsBoard from '@/components/pickups/PickupsBoard'

export const dynamic = 'force-dynamic'

export default async function PickupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role as UserRole | undefined
  if (!canReadFreeShipments(role)) redirect('/orders')

  const [{ data: open }, { data: closed }] = await Promise.all([
    supabase
      .from('pickups')
      .select('*')
      .in('status', ['solicitada', 'programada', 'incidencia', 'en_curso'])
      .order('created_at', { ascending: true }),
    supabase
      .from('pickups')
      .select('*')
      .in('status', ['recibida', 'anulada'])
      .order('updated_at', { ascending: false })
      .limit(20),
  ])

  const openPickups = (open ?? []) as Pickup[]
  // En curso: primero las que tienen incidencia, luego por dia de recogida.
  const active = openPickups
    .filter((p) => p.status !== 'solicitada')
    .sort((a, b) => {
      const ia = a.status === 'incidencia' ? 0 : 1
      const ib = b.status === 'incidencia' ? 0 : 1
      if (ia !== ib) return ia - ib
      return (a.pickup_date ?? '').localeCompare(b.pickup_date ?? '')
    })

  const today = todayInMadrid()

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recogidas</h1>
        <p className="mt-1 text-sm text-gray-500">
          TIPSA recoge en casa del cliente y lo trae a nuestro almacén o al SAT del proveedor.
        </p>
      </div>
      <PickupsBoard
        requested={openPickups.filter((p) => p.status === 'solicitada')}
        active={active}
        closed={(closed ?? []) as Pickup[]}
        canManage={canManagePickups(role)}
        services={loadServicesCatalog()}
        defaultServiceCode={process.env.TIPSA_PICKUP_SERVICE_CODE ?? '48'}
        defaultDate={nextWorkingDay(today)}
        minDate={today}
      />
    </div>
  )
}
