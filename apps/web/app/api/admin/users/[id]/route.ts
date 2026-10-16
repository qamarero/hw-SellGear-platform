import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/lib/auth'
import type { UserRole } from '@/types/database'

const VALID_ROLES: UserRole[] = ['viewer', 'commercial', 'hardware', 'manager', 'admin']

/** Ban de Supabase Auth para un usuario desactivado: ~100 años, "para siempre". */
const DEACTIVATED_BAN = '876000h'

async function verifyAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'No autenticado', status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, role')
    .eq('id', user.id)
    .single()

  if (!isAdminUser(profile?.email ?? user.email, profile?.role)) {
    return { error: 'Sin permisos de administrador', status: 403 }
  }

  return { supabase, user }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdmin()
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  const { supabase, user } = auth
  const body = await request.json()

  // Reactivar / desactivar el acceso (ban de Supabase Auth). Es lo que usa
  // un usuario con historial en lugar del borrado: ver DELETE.
  if (typeof body.active === 'boolean') {
    if (!body.active && id === user.id) {
      return NextResponse.json(
        { error: 'No puedes desactivar tu propia cuenta' },
        { status: 400 },
      )
    }
    const { error: banError } = await createAdminClient().auth.admin.updateUserById(id, {
      ban_duration: body.active ? 'none' : DEACTIVATED_BAN,
    })
    if (banError) {
      return NextResponse.json({ error: banError.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, deactivated: !body.active })
  }

  const updates: Record<string, unknown> = {}

  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.department !== undefined) updates.department = body.department
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: 'Rol no valido' }, { status: 400 })
    }
    updates.role = body.role
  }
  // Slack member ID (manual, para menciones en avisos). Aceptamos string o
  // null/'' para limpiar. Validación laxa (Slack member IDs empiezan por U
  // mayúscula + alfanum, pero no enforce para no romper si Slack cambia).
  if (body.slack_user_id !== undefined) {
    const raw = body.slack_user_id
    if (raw === null || raw === '') {
      updates.slack_user_id = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      updates.slack_user_id = trimmed === '' ? null : trimmed
    } else {
      return NextResponse.json(
        { error: 'slack_user_id debe ser string o null' },
        { status: 400 },
      )
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ user: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdmin()
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  const { user } = auth

  // No permitir eliminarse a si mismo
  if (id === user.id) {
    return NextResponse.json(
      { error: 'No puedes eliminar tu propia cuenta' },
      { status: 400 }
    )
  }

  // Eliminar de auth.users con admin client (cascadea a user_profiles por FK)
  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.deleteUser(id)

  if (!error) {
    return NextResponse.json({ success: true, deactivated: false })
  }
  if (error.status === 404) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }

  /*
   * El borrado falla ("Database error deleting user") cuando el usuario ya ha
   * hecho algo en la app: user_profiles cae en cascada al borrar auth.users,
   * pero lo referencian sin ON DELETE orders.created_by/assigned_to,
   * status_history.changed_by, comments.author_id, address_book.created_by y
   * shipments.created_by. Borrarlo dejaría pedidos e historial sin autor, así
   * que en ese caso se DESACTIVA: se le bloquea el acceso (ban de Supabase
   * Auth) y se conserva todo lo que hizo. Se puede reactivar desde la lista.
   */
  const { error: banError } = await adminClient.auth.admin.updateUserById(id, {
    ban_duration: DEACTIVATED_BAN,
  })
  if (banError) {
    return NextResponse.json(
      { error: `No se pudo borrar (${error.message}) ni desactivar: ${banError.message}` },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true, deactivated: true })
}
