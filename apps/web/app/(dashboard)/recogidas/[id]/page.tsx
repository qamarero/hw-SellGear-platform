import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Pickup, PickupEvent, UserRole } from '@/types/database'
import { canManagePickups, canReadFreeShipments } from '@/lib/auth'
import { loadServicesCatalog } from '@/lib/tipsa/services'
import { formatPickupWindow, nextWorkingDay, pickupBadgeLabel } from '@/lib/pickups/format'
import { PICKUP_REASON_LABELS } from '@/lib/pickups/status'
import { todayInMadrid } from '@/lib/pickups/validate'
import PickupStatusBadge from '@/components/pickups/PickupStatusBadge'
import PickupActions from '@/components/pickups/PickupActions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const KIND_LABELS: Record<PickupEvent['kind'], string> = {
  app: 'MainOps',
  recogida: 'TIPSA · recogida',
  envio: 'TIPSA · envío',
}

export default async function PickupDetailPage({ params }: PageProps) {
  const { id } = await params
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

  const { data: pickup, error } = await supabase.from('pickups').select('*').eq('id', id).single<Pickup>()
  if (error || !pickup) notFound()

  const { data: eventsData } = await supabase
    .from('pickup_events')
    .select('*')
    .eq('pickup_id', pickup.id)
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
  const events = (eventsData ?? []) as PickupEvent[]

  const today = todayInMadrid()
  const destination: [string, string][] =
    pickup.destination_type === 'sat'
      ? [
          ['Destino', 'SAT del proveedor'],
          ['Nombre', pickup.destination_name ?? '—'],
          ['Dirección', pickup.destination_address ?? '—'],
          ['CP / Ciudad', `${pickup.destination_cp ?? ''} ${pickup.destination_city ?? ''}`.trim() || '—'],
          ['Contacto', [pickup.destination_contact, pickup.destination_phone].filter(Boolean).join(' · ') || '—'],
        ]
      : [['Destino', 'Nuestro almacén (remitente TIPSA)']]

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/recogidas" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
          ← Volver a recogidas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{pickup.pickup_id}</h1>
          <PickupStatusBadge status={pickup.status} label={pickupBadgeLabel(pickup)} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {pickup.source === 'hsm'
            ? `Pedida desde HSM · ${pickup.source_ref}${pickup.requested_by_name ? ` · ${pickup.requested_by_name}` : ''}`
            : `Alta manual · ${PICKUP_REASON_LABELS[pickup.reason]}`}
        </p>
      </div>

      {canManagePickups(role) && (
        <PickupActions
          pickup={pickup}
          services={loadServicesCatalog()}
          defaultServiceCode={process.env.TIPSA_PICKUP_SERVICE_CODE ?? '48'}
          defaultDate={nextWorkingDay(today)}
          minDate={today}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReadOnlyCard
          title="Recoger en"
          rows={[
            ['Nombre', pickup.origin_name],
            ['Dirección', pickup.origin_address],
            ['CP / Ciudad', `${pickup.origin_cp} ${pickup.origin_city}`],
            ['Contacto', pickup.origin_contact ?? '—'],
            ['Teléfono', pickup.origin_phone],
          ]}
        />
        <ReadOnlyCard title="Llevar a" rows={destination} />
        <ReadOnlyCard
          title="Qué se recoge"
          rows={[
            [
              'Equipos',
              pickup.items.length > 0
                ? pickup.items.map((it) => (it.serial ? `${it.description} (SN ${it.serial})` : it.description)).join(', ')
                : '—',
            ],
            ['Bultos', String(pickup.packages)],
            ['Peso', `${pickup.weight_kg} kg`],
            ['Instrucciones', pickup.instructions ?? '—'],
          ]}
        />
        <ReadOnlyCard
          title="TIPSA"
          rows={[
            ['Cuándo', formatPickupWindow(pickup) ?? 'Sin programar'],
            ['Código', pickup.tipsa_code ?? '—'],
            ['Servicio', pickup.service_code ?? '—'],
            ['Envío generado', pickup.albaran ?? '—'],
            [
              'Incidencia',
              pickup.status === 'incidencia'
                ? [pickup.incidence_label, pickup.incidence_obs].filter(Boolean).join(' · ') || 'Sin detalle'
                : '—',
            ],
            ['Anulación', pickup.cancel_reason ?? (pickup.status === 'anulada' ? 'Sin motivo' : '—')],
          ]}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Historial</h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-400">Sin movimientos todavía.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                <div className="min-w-0">
                  <p className="text-gray-900">{ev.event_label ?? `Estado ${ev.event_code}`}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(ev.event_date).toLocaleString('es-ES', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Europe/Madrid',
                    })}{' '}
                    · {KIND_LABELS[ev.kind]}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function ReadOnlyCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-2">
            <dt className="col-span-1 text-xs text-gray-500">{label}</dt>
            <dd className="col-span-2 text-gray-900 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
