# ADR 2026-10-28 — Login solo con Google

## Contexto
MainOperation entraba con email + contraseña y su propio registro. La comprobación
de `@qamarero.com` solo estaba en el navegador, y la política `user_profiles: own
update` dejaba a cualquier usuario cambiarse el rol. Toolbox y el Catálogo ya
entran solo con Google (Workspace de Qamarero).

## Decisión
- **Solo Google** (cuentas @qamarero.com del Workspace). Sin contraseñas, registro
  ni recuperación. El cliente OAuth es «Supabase Main-Ops» (Google Cloud
  *Qamarero Toolbox*, audiencia *Internal*).
- **Mismos usuarios y roles:** al entrar con Google, Supabase enlaza la cuenta
  existente por email (mismo `auth.users.id`), así que `user_profiles.role` se
  conserva. Una cuenta nueva entra como `viewer`.
- **Sesión de 7 días** desde que se entró con Google (claim `amr` del JWT). Quien
  sale del Workspace pierde el acceso como mucho en una semana, sin depender de
  nadie.
- La regla está en tres sitios:
  - `lib/supabase/middleware.ts`: páginas y APIs. Las APIs externas y los cron
    van sin sesión.
  - `app/api/auth/callback/route.ts`.
  - La BD: `mo_google_session()`, que usan `get_my_role()` y las políticas sin
    rol. Migración `20261028200000_login_solo_google.sql`.
- Se cierra la escalada de rol (`own update` con `WITH CHECK`) y el alta exige
  @qamarero.com (`handle_new_user`).

## Consecuencias
- Las altas por adelantado (Admin → Usuarios → Nuevo) crean la cuenta sin
  contraseña con su rol; la persona entra con Google y se enlaza por email.
- Desactivar / eliminar usuarios sigue igual.
- Cada semana hay que volver a pulsar «Entrar con Google».
