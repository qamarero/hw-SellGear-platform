'use client'

import { useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { buildCSV, downloadCSV } from '@/lib/csv'
import type { UserProfile, UserRole } from '@/types/database'

const ROLE_LABELS: Record<UserRole, string> = {
  viewer: 'Viewer',
  commercial: 'Comercial',
  hardware: 'Hardware',
  manager: 'Manager',
  admin: 'Admin',
}

const ROLE_COLORS: Record<UserRole, string> = {
  viewer: 'bg-gray-100 text-gray-800',
  commercial: 'bg-blue-100 text-blue-800',
  hardware: 'bg-purple-100 text-purple-800',
  manager: 'bg-green-100 text-green-800',
  admin: 'bg-red-100 text-red-800',
}

type EditingUser = {
  id: string
  full_name: string
  role: UserRole
  department: string
  slack_user_id: string
}

type NewUser = {
  email: string
  password: string
  full_name: string
  role: UserRole
  department: string
}

/** Usuario al que se le está fijando una contraseña nueva desde el modal. */
type PasswordTarget = {
  id: string
  email: string
}

/**
 * `deactivated`: acceso bloqueado (ban de Supabase Auth). Es lo que queda de
 * un usuario con historial al "eliminarlo": no puede entrar, pero sus pedidos
 * y comentarios siguen diciendo quién los hizo.
 */
type AdminUser = UserProfile & { deactivated?: boolean }

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('')
  const [editing, setEditing] = useState<EditingUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState<NewUser>({
    email: '',
    password: '',
    full_name: '',
    role: 'viewer',
    department: '',
  })
  const [passwordTarget, setPasswordTarget] = useState<PasswordTarget | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  // El error del cambio de contraseña se pinta dentro del modal: el aviso
  // general vive arriba de la tabla y el modal lo tapa.
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando usuarios')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 4000)
  }

  const handleEdit = (user: UserProfile) => {
    setEditing({
      id: user.id,
      full_name: user.full_name ?? '',
      role: user.role,
      department: user.department ?? '',
      slack_user_id: user.slack_user_id ?? '',
    })
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)

    try {
      const res = await fetch(`/api/admin/users/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editing.full_name,
          role: editing.role,
          department: editing.department,
          slack_user_id: editing.slack_user_id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setUsers((prev) =>
        prev.map((u) => (u.id === editing.id ? { ...u, ...data.user } : u))
      )
      setEditing(null)
      showFeedback('success', 'Usuario actualizado correctamente')
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleResetPassword = async (userId: string, email: string) => {
    if (!confirm(`Se enviara un email de recuperacion a ${email}. ¿Continuar?`)) return

    setActionLoading(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      showFeedback('success', data.message)
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Error al enviar reset')
    } finally {
      setActionLoading(null)
    }
  }

  const closePasswordModal = () => {
    setPasswordTarget(null)
    setNewPassword('')
    setRepeatPassword('')
    setPasswordError(null)
  }

  const handleSetPassword = async () => {
    if (!passwordTarget) return

    if (newPassword.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== repeatPassword) {
      setPasswordError('Las dos contraseñas no coinciden')
      return
    }

    setSaving(true)
    setPasswordError(null)
    try {
      const res = await fetch(`/api/admin/users/${passwordTarget.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      closePasswordModal()
      showFeedback('success', data.message)
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'Error al cambiar la contraseña'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (userId: string, name: string) => {
    if (
      !confirm(
        `¿Eliminar a "${name}"?\n\nSi ya tiene pedidos, comentarios o historial en la app, se DESACTIVARÁ en su lugar: no podrá entrar, pero se conserva quién hizo cada cosa. Si no tiene nada, se borra del todo.`,
      )
    )
      return

    setActionLoading(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (data.deactivated) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, deactivated: true } : u)),
        )
        showFeedback(
          'success',
          `"${name}" tiene historial en la app: se ha desactivado y ya no puede entrar.`,
        )
      } else {
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        showFeedback('success', 'Usuario eliminado correctamente')
      }
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSetActive = async (userId: string, name: string, active: boolean) => {
    setActionLoading(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, deactivated: !active } : u)),
      )
      showFeedback(
        'success',
        active ? `"${name}" reactivado: ya puede entrar.` : `"${name}" desactivado.`,
      )
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Error al cambiar el acceso')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCreate = async () => {
    if (!newUser.email || !newUser.password) {
      showFeedback('error', 'Email y contraseña son obligatorios')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setUsers((prev) => [data.user, ...prev])
      setCreating(false)
      setNewUser({ email: '', password: '', full_name: '', role: 'viewer', department: '' })
      showFeedback('success', `Usuario ${data.user.email} creado correctamente`)
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Error al crear usuario')
    } finally {
      setSaving(false)
    }
  }

  // Filtrado
  const filtered = users.filter((u) => {
    const matchesSearch =
      !search ||
      (u.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (u.department ?? '').toLowerCase().includes(search.toLowerCase())

    const matchesRole = !roleFilter || u.role === roleFilter

    return matchesSearch && matchesRole
  })

  const handleExportCSV = () => {
    const csv = buildCSV(filtered, [
      { key: 'full_name', header: 'Nombre', transform: (v) => String(v ?? '') },
      { key: 'email', header: 'Email', transform: (v) => String(v ?? '') },
      { key: 'role', header: 'Rol', transform: (v) => ROLE_LABELS[v as UserRole] ?? String(v) },
      { key: 'department', header: 'Departamento', transform: (v) => String(v ?? '') },
      {
        key: 'created_at',
        header: 'Fecha Registro',
        transform: (v) => (v ? new Date(String(v)).toLocaleDateString('es-ES') : ''),
      },
    ])
    const today = new Date().toISOString().slice(0, 10)
    downloadCSV(csv, `usuarios_export_${today}.csv`)
  }

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Cargando usuarios...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="rounded-lg bg-red-50 px-6 py-4 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestion de Usuarios</h1>
          <p className="mt-1 text-sm text-gray-500">
            {users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}
            {users.some((u) => u.deactivated) &&
              ` · ${users.filter((u) => u.deactivated).length} desactivado${
                users.filter((u) => u.deactivated).length !== 1 ? 's' : ''
              }`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exportar CSV
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo usuario
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={cn(
            'mb-4 rounded-lg px-4 py-3 text-sm ring-1',
            feedback.type === 'success'
              ? 'bg-green-50 text-green-700 ring-green-200'
              : 'bg-red-50 text-red-700 ring-red-200'
          )}
        >
          {feedback.message}
        </div>
      )}

      {/* Filtros */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Buscar por nombre, email o departamento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value="">Todos los roles</option>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Usuario</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Rol</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Departamento</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Registro</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No se encontraron usuarios
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr
                    key={user.id}
                    className={cn(
                      'hover:bg-gray-50 transition-colors',
                      user.deactivated && 'bg-gray-50/60 text-gray-400'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                          {(user.full_name ?? user.email ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <span
                          className={cn(
                            'font-medium',
                            user.deactivated ? 'text-gray-500 line-through' : 'text-gray-900'
                          )}
                        >
                          {user.full_name ?? '(sin nombre)'}
                        </span>
                        {user.deactivated && (
                          <span
                            className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                            title="No puede entrar. Se conserva su historial."
                          >
                            Desactivado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          ROLE_COLORS[user.role]
                        )}
                      >
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.department ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(user)}
                          disabled={actionLoading === user.id}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          title="Editar usuario"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() =>
                            setPasswordTarget({ id: user.id, email: user.email ?? '' })
                          }
                          disabled={actionLoading === user.id}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          title="Fijar una contraseña nueva ahora"
                        >
                          Contraseña
                        </button>
                        <button
                          onClick={() => handleResetPassword(user.id, user.email ?? '')}
                          disabled={actionLoading === user.id || !user.email}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                          title="Enviar email de reset de contrasena"
                        >
                          {actionLoading === user.id ? '...' : 'Reset pwd'}
                        </button>
                        {user.deactivated ? (
                          <button
                            onClick={() =>
                              handleSetActive(user.id, user.full_name ?? user.email ?? '', true)
                            }
                            disabled={actionLoading === user.id}
                            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50"
                            title="Devolverle el acceso"
                          >
                            Reactivar
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDelete(user.id, user.full_name ?? user.email ?? '')}
                            disabled={actionLoading === user.id}
                            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                            title="Eliminar usuario (se desactiva si tiene historial)"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de edicion */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Editar usuario</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Nombre completo
                </label>
                <input
                  type="text"
                  value={editing.full_name}
                  onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Rol
                </label>
                <select
                  value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as UserRole })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Departamento
                </label>
                <input
                  type="text"
                  value={editing.department}
                  onChange={(e) => setEditing({ ...editing, department: e.target.value })}
                  placeholder="Ej: Ventas, Hardware, IT..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Slack member ID
                </label>
                <input
                  type="text"
                  value={editing.slack_user_id}
                  onChange={(e) => setEditing({ ...editing, slack_user_id: e.target.value })}
                  placeholder="U01ABCDEFGH (empieza por U)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  En Slack: perfil del usuario → menú <span className="font-mono">⋮</span> → &ldquo;Copiar member ID&rdquo;. Necesario
                  para mencionarle automáticamente en los avisos del canal de Hardware.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de creacion */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Nuevo usuario</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="usuario@qamarero.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Contraseña <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Minimo 6 caracteres"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Nombre completo
                </label>
                <input
                  type="text"
                  value={newUser.full_name}
                  onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  placeholder="Nombre y apellidos"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Rol
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Departamento
                </label>
                <input
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  placeholder="Ej: Ventas, Hardware, IT..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setCreating(false)
                  setNewUser({ email: '', password: '', full_name: '', role: 'viewer', department: '' })
                }}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {saving ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de cambio de contraseña */}
      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Cambiar contraseña</h2>
            <p className="mt-1 mb-4 text-sm text-gray-500">
              {passwordTarget.email || 'Usuario sin email'}
            </p>

            {passwordError && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {passwordError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Nueva contraseña <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Repetir contraseña <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="La misma otra vez"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <p className="text-xs text-gray-500">
                El usuario podrá entrar con ella de inmediato y la anterior deja de
                servir. Las sesiones que ya tenga abiertas no se cierran, así que
                cámbiala solo cuando te lo pida esa persona.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closePasswordModal}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSetPassword}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
