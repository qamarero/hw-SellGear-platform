import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { googleSessionStatus } from '@/lib/google-session'

// Sin sesión de usuario: claves de API (/api/external), cron con secreto y la
// vuelta del login con Google (el callback crea la sesión).
const NO_SESSION_PREFIXES = ['/api/external/', '/api/cron/', '/api/auth/callback']

/**
 * Primera barrera: solo se entra con Google (@qamarero.com) y la sesión vale 7
 * días desde que se entró con Google. Cualquier otra sesión (p. ej. una antigua
 * con contraseña) se cierra: las páginas van a /login y las APIs responden 401.
 * La BD aplica la misma regla en RLS (public.mo_google_session).
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (NO_SESSION_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { data: claimsData } = user ? await supabase.auth.getClaims() : { data: null }
  const status = user ? googleSessionStatus(claimsData?.claims) : null

  const isLoginPage = pathname.startsWith('/login')
  const isApiRoute = pathname.startsWith('/api')

  if (status === 'valid') {
    if (!isLoginPage) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/orders'
    url.search = ''
    return withCookies(NextResponse.redirect(url), supabaseResponse)
  }

  // Sesión que no vale: se cierra en este navegador antes de seguir.
  if (status) await supabase.auth.signOut({ scope: 'local' })

  if (isLoginPage) return supabaseResponse
  if (isApiRoute) {
    return withCookies(NextResponse.json({ error: 'Inicia sesión con Google' }, { status: 401 }), supabaseResponse)
  }

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  if (status) url.searchParams.set('error', status)
  if (pathname !== '/') url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
  return withCookies(NextResponse.redirect(url), supabaseResponse)
}

/** Lleva a la respuesta final las cookies que Supabase haya renovado o borrado. */
function withCookies(response: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}
