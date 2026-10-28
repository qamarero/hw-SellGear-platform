'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Abre el login de Google vía Supabase; vuelve a /api/auth/callback (flujo PKCE). */
export function GoogleSignInButton({ next }: { next: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function signIn() {
    setLoading(true)
    setError(false)
    const callback = new URL('/api/auth/callback', window.location.origin)
    callback.searchParams.set('next', next)
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        // `hd` solo filtra el selector de cuentas; el callback, el middleware y la BD exigen el dominio.
        queryParams: { hd: 'qamarero.com', prompt: 'select_account' },
      },
    })
    if (error) {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          No se pudo abrir el inicio de sesión con Google. Inténtalo de nuevo.
        </div>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
        </svg>
        {loading ? 'Un momento...' : 'Entrar con Google'}
      </button>
    </>
  )
}
