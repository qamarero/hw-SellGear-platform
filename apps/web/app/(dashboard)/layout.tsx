import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import SidebarNav from '@/components/layout/SidebarNav'
import RealtimeRefresh from '@/components/layout/RealtimeRefresh'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load user profile for display
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name, email, role')
    .eq('id', user.id)
    .single()

  // Count new orders per purchase_type for sidebar badges
  // Simply count orders with status 'nuevo' — AutoMarkSeen transitions
  // them to 'pendiente' when viewed, and "Limpiar" bulk-transitions all
  const { data: newCounts } = await supabase
    .from('orders')
    .select('purchase_type')
    .eq('status', 'nuevo')

  const badgeCounts: Record<string, number> = {}
  let totalNew = 0
  if (newCounts) {
    for (const row of newCounts) {
      const pt = row.purchase_type ?? 'otro'
      badgeCounts[pt] = (badgeCounts[pt] ?? 0) + 1
      totalNew++
    }
  }

  // Recogidas pedidas (sobre todo desde HSM) que logistica aun no ha
  // programado en TIPSA. Si la tabla aun no existe, error -> 0 sin romper.
  const { count: pendingPickups } = await supabase
    .from('pickups')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'solicitada')

  const displayName = profile?.full_name ?? user.email ?? 'Usuario'
  const displayRole = profile?.role ?? '—'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col bg-gray-900 text-white">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-5 border-b border-gray-700">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">MainOperation</p>
            <p className="text-xs text-gray-400 mt-0.5">Hardware</p>
          </div>
        </div>

        {/* Navigation */}
        <Suspense fallback={<div className="flex-1" />}>
          <SidebarNav userEmail={profile?.email ?? user.email} userRole={profile?.role} badgeCounts={badgeCounts} totalNew={totalNew} pendingPickups={pendingPickups ?? 0} />
        </Suspense>

        {/* User info + logout */}
        <div className="border-t border-gray-700 px-4 py-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-gray-400 capitalize">{displayRole}</p>
          </div>
          <form
            action={async () => {
              'use server'
              const supabase = await createClient()
              await supabase.auth.signOut()
              redirect('/login')
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
      <RealtimeRefresh />
    </div>
  )
}
