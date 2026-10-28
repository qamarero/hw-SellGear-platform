-- =============================================================
-- Login solo con Google (cuentas @qamarero.com) y sesión de 7 días.
--
-- La app ya solo ofrece «Entrar con Google» y el middleware cierra cualquier
-- otra sesión, pero el navegador también habla directo con Supabase (escrituras,
-- storage, realtime). Esta migración aplica la misma regla en RLS:
--
--   · mo_google_session(): el JWT es de una cuenta @qamarero.com que entró con
--     Google (amr = oauth) hace menos de 7 días (+1 h de margen para que la app
--     cierre la sesión antes). Renovar la sesión no vuelve a preguntar a Google,
--     entrar sí: quien sale del Workspace se queda fuera como mucho en una semana.
--   · get_my_role() solo devuelve rol con esa sesión → las ~60 políticas por rol
--     la exigen sin tocarlas una a una. Igual las de lectura «authenticated», el
--     propio perfil, la subida/borrado de adjuntos y get_inventory_by_type().
--   · Cierra la escalada: «own update» ya no deja cambiarse el rol.
--   · handle_new_user rechaza cuentas que no sean @qamarero.com.
--
-- No cambia nada para service role (APIs externas, cron, Typeform) ni qarvis_ro.
-- Aplicada a mano en Supabase el 2026-10-28, tras desplegar la app.
-- =============================================================

create or replace function public.mo_google_session()
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(lower(auth.jwt() ->> 'email') ~ '^[a-z0-9._%+-]+@qamarero\.com$', false)
     and exists (
       select 1
       from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
       ) as m
       where m ->> 'method' = 'oauth'
         and jsonb_typeof(m -> 'timestamp') = 'number'
         and (m ->> 'timestamp')::numeric >= extract(epoch from now() - interval '7 days 1 hour')
     )
$function$;

create or replace function public.get_my_role()
 returns public.user_role
 language sql
 stable security definer
 set search_path to ''
as $function$
  select role from public.user_profiles where id = auth.uid() and public.mo_google_session();
$function$;

-- Perfil propio: solo con sesión de Google, y sin poder cambiarse el rol (antes
-- «own update» no tenía WITH CHECK: cualquiera podía hacerse admin).
alter policy "user_profiles: own read" on public.user_profiles
  using (id = auth.uid() and public.mo_google_session());

alter policy "user_profiles: own update" on public.user_profiles
  using (id = auth.uid() and public.mo_google_session())
  with check (id = auth.uid() and role = public.get_my_role());

-- Lecturas abiertas a cualquier sesión → solo sesiones de Google.
alter policy "products: authenticated read" on public.products using (public.mo_google_session());
alter policy "order_payments: authenticated read" on public.order_payments using (public.mo_google_session());
alter policy "stock_pools: authenticated read" on public.stock_pools using (public.mo_google_session());
alter policy "product_stock_components: authenticated read" on public.product_stock_components
  using (public.mo_google_session());

-- Adjuntos de pedidos: subir y borrar, solo con sesión de Google.
alter policy "Authenticated users can upload" on storage.objects
  with check (bucket_id = 'order-attachments' and public.mo_google_session());
alter policy "Authenticated users can delete" on storage.objects
  using (bucket_id = 'order-attachments' and public.mo_google_session());

-- Inventario (SECURITY DEFINER, no pasa por RLS): misma regla.
create or replace function public.get_inventory_by_type()
 returns table(tipo_articulo text, total_unidades_nuevas bigint)
 language plpgsql
 security definer
 set search_path to 'public', 'hw_staging'
as $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'hardware', 'commercial')
      AND public.mo_google_session()
  ) THEN
    RAISE EXCEPTION 'No autorizado para consultar inventario'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      a.article_type::TEXT,
      COUNT(*)::BIGINT
    FROM hw_staging.hw_inventory i
    JOIN hw_staging.hw_articles a ON i.article_id = a.id
    WHERE i.estado = 'disponible'
      AND i.condicion = 'nuevo'
    GROUP BY a.article_type
    ORDER BY 2 DESC;
END;
$function$;

-- Altas: solo cuentas @qamarero.com (Google Internal ya lo limita; esto cubre
-- cualquier otra vía, p. ej. la API de admin).
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF lower(NEW.email) !~ '^[a-z0-9._%+-]+@qamarero\.com$' THEN
    RAISE EXCEPTION 'Solo cuentas @qamarero.com' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
