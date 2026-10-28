import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { googleSessionStatus, safeNextPath } from '@/lib/google-session'

/**
 * Vuelta del login con Google (vía Supabase, flujo PKCE). Canjea el código y deja
 * la sesión en cookies; si la cuenta no es @qamarero.com la cierra al momento.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))
  const toLogin = (error: string) => NextResponse.redirect(`${origin}/login?error=${error}`)

  if (!code) return toLogin('google')

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return toLogin('google')

  const { data } = await supabase.auth.getClaims()
  if (googleSessionStatus(data?.claims) !== 'valid') {
    await supabase.auth.signOut({ scope: 'local' })
    return toLogin('invalid')
  }

  return NextResponse.redirect(`${origin}${next}`)
}
