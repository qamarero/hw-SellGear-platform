import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/lib/auth'
import { ALLOWED_EMAIL } from '@/lib/google-session'
import type { UserRole } from '@/types/database'

const VALID_ROLES: UserRole[] = ['viewer', 'commercial', 'hardware', 'manager', 'admin']

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

export async function GET() {
  const auth = await verifyAdmin()
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { supabase } = auth

  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Desactivados = con ban vigente en Supabase Auth (ver DELETE en [id]).
  // No vive en user_profiles: se lee de auth, paginando (50 por página por
  // defecto). Si falla, la lista sale igual, sin la marca.
  const banned = new Set<string>()
  try {
    const admin = createAdminClient()
    const now = Date.now()
    for (let page = 1; page <= 20; page++) {
      const { data, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      })
      if (listError) break
      for (const u of data.users) {
        if (u.banned_until && new Date(u.banned_until).getTime() > now) banned.add(u.id)
      }
      if (data.users.length < 200) break
    }
  } catch (err) {
    console.error('[admin/users] no se pudo leer el estado de acceso:', err)
  }

  return NextResponse.json({
    users: (users ?? []).map((u) => ({ ...u, deactivated: banned.has(u.id) })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdmin()
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { full_name, role, department } = body
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Solo se entra con Google: la cuenta se crea sin contraseña y, cuando la
  // persona entre con su Google @qamarero.com, Supabase la enlaza por email y
  // conserva el rol asignado aquí.
  if (!ALLOWED_EMAIL.test(email)) {
    return NextResponse.json({ error: 'Solo cuentas @qamarero.com' }, { status: 400 })
  }

  if (role && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Rol no valido' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Crear usuario en auth
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: full_name || null },
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  // Insertar perfil (el trigger on_auth_user_created puede haberlo creado ya,
  // asi que usamos upsert)
  const { error: profileError } = await adminClient
    .from('user_profiles')
    .upsert({
      id: authData.user.id,
      email,
      full_name: full_name || null,
      role: role || 'viewer',
      department: department || null,
    })

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Devolver el perfil completo
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single()

  return NextResponse.json({ user: profile }, { status: 201 })
}
