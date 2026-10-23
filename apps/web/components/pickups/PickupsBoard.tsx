'use client'

import { useState } from 'react'
import Link from 'next/link'
import PickupStatusBadge from './PickupStatusBadge'
import SchedulePickupModal from './SchedulePickupModal'
import NewPickupModal from './NewPickupModal'
import { formatPickupWindow, pickupBadgeLabel, pickupDestinationLabel } from '@/lib/pickups/format'
import { PICKUP_REASON_LABELS, shortTime } from '@/lib/pickups/status'
import type { Pickup } from '@/types/database'

interface PickupsBoardProps {
  requested: Pickup[]
  active: Pickup[]
  closed: Pickup[]
  canManage: boolean
  services: Array<{ code: string; label: string }>
  defaultServiceCode: string
  defaultDate: string
  minDate: string
}

export default function PickupsBoard({
  requested,
  active,
  closed,
  canManage,
  services,
  defaultServiceCode,
  defaultDate,
  minDate,
}: PickupsBoardProps) {
  const [scheduling, setScheduling] = useState<Pickup | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva recogida
          </button>
        </div>
      )}

      {/* Pendientes de programar: lo unico que pide accion a logistica */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Pendientes de programar</h2>
          {requested.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
              {requested.length}
            </span>
          )}
        </div>
        {requested.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">No hay recogidas por programar.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {requested.map((p) => (
              <div key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-gray-600">
                    {p.source === 'hsm' ? `HSM · ${p.source_ref}` : `${PICKUP_REASON_LABELS[p.reason]} · ${p.pickup_id}`}
                  </p>
                  <Link href={`/recogidas/${p.id}`} className="text-sm font-medium text-gray-900 hover:text-gray-700">
                    {p.origin_name}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {p.origin_city} {p.origin_cp} → {pickupDestinationLabel(p)}
                    {p.items.length > 0 && ` · ${p.items.map((it) => it.description).join(', ')}`}
                  </p>
                  {p.time_from && p.time_to && (
                    <p className="text-xs text-gray-500">
                      Horario del cliente: {shortTime(p.time_from)}–{shortTime(p.time_to)}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-shrink-0 gap-2">
                    <Link
                      href={`/recogidas/${p.id}`}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Ver
                    </Link>
                    <button
                      type="button"
                      onClick={() => setScheduling(p)}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
                    >
                      Programar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <PickupsTable title="En curso" pickups={active} empty="No hay recogidas en curso." />
      <PickupsTable title="Últimas cerradas" pickups={closed} empty="Todavía no hay recogidas cerradas." />

      {scheduling && (
        <SchedulePickupModal
          pickup={scheduling}
          services={services}
          defaultServiceCode={defaultServiceCode}
          defaultDate={defaultDate}
          minDate={minDate}
          onClose={() => setScheduling(null)}
        />
      )}
      {creating && <NewPickupModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function PickupsTable({ title, pickups, empty }: { title: string; pickups: Pickup[]; empty: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Recogida</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Destino</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cuándo</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pickups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    {empty}
                  </td>
                </tr>
              ) : (
                pickups.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/recogidas/${p.id}`} className="font-medium text-gray-900 hover:text-gray-700">
                        {p.pickup_id}
                      </Link>
                      <p className="font-mono text-[11px] text-gray-400">
                        {p.source === 'hsm' ? `HSM · ${p.source_ref}` : PICKUP_REASON_LABELS[p.reason]}
                        {p.tipsa_code && ` · ${p.tipsa_code}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{p.origin_name}</p>
                      <p className="text-xs text-gray-500">
                        {p.origin_cp} {p.origin_city}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{pickupDestinationLabel(p)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{formatPickupWindow(p) ?? '—'}</td>
                    <td className="px-4 py-3">
                      <PickupStatusBadge status={p.status} label={pickupBadgeLabel(p)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
