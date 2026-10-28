import { safeNextPath } from '@/lib/google-session'
import { GoogleSignInButton } from './google-sign-in-button'

// Errores que traen el middleware (sesión caducada o no válida) y el callback.
const ERRORS: Record<string, string> = {
  expired: 'Por seguridad, cada 7 días hay que volver a entrar con Google.',
  invalid: 'Esa sesión no es válida. Entra con tu cuenta de Google @qamarero.com.',
  google: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
}

type Props = { searchParams: Promise<{ error?: string | string[]; next?: string | string[] }> }

/** Solo se entra con Google (cuentas @qamarero.com del Workspace). */
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams
  const error = typeof params.error === 'string' && Object.hasOwn(ERRORS, params.error) ? ERRORS[params.error] : null
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white px-8 py-10 shadow-lg ring-1 ring-gray-200">

          {/* Branding */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand">
              <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">MainOperation</h1>
            <p className="mt-1 text-sm text-gray-500">Hardware · Gestión de Pedidos</p>
          </div>

          <h2 className="mb-6 text-center text-lg font-semibold text-gray-700">Iniciar sesión</h2>

          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          <GoogleSignInButton next={next} />

          <p className="mt-5 text-center text-xs text-gray-400">
            Acceso restringido al equipo de Qamarero, con tu cuenta de Google @qamarero.com.
            Por seguridad, se pide de nuevo cada 7 días.
          </p>
        </div>
      </div>
    </div>
  )
}
