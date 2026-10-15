-- =============================================================
-- Control de stock: pedidos limitados al stock real (admins exentos).
--
-- El stock físico vive en HWToolbox (otro proyecto Supabase,
-- hw_staging.*). Esta migración pone en MainOps lo que solo MainOps sabe:
--
--   1. stock_pools               qué artículos de HWToolbox son
--                                intercambiables (p.ej. TPV Pro = 3 modelos).
--   2. product_stock_components  de qué pools tira cada producto del
--                                catálogo, y cuántas unidades (packs = varios).
--   3. get_stock_commitments()   unidades vendidas en MainOps que HWToolbox
--                                todavía no ha descontado.
--   4. order_items               solo un admin puede insertar o modificar
--                                líneas directamente; el resto, por la API.
--
-- Stock pedible = disponible en HWToolbox − comprometido en MainOps. La
-- cuenta la hace la app (lib/stock/), que es la única que ve los dos
-- proyectos. El stock NUNCA se guarda aquí: products lo lee cualquiera.
--
-- Reglas que viven en la app, no aquí:
--   * categorías service/custom: sin control de stock;
--   * producto físico SIN fila en product_stock_components: pedible 0 para
--     no-admin (hoy: kds-estandar, kds-premium y los dos sensores doBBox);
--   * admins (isAdminUser) piden sin límite, pero sus pedidos reservan igual.
--
-- article_ids son UUID de hw_staging.hw_articles (proyecto
-- olcxbtvjkjmofrbvzpat). No puede haber FK entre proyectos: se verificaron
-- uno a uno contra hw_articles el 2026-10-15.
--
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- IDEMPOTENTE. La tabla de componentes se reescribe entera desde este
-- fichero: es la fuente del mapeo inicial.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Pools de artículos intercambiables
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_pools (
  key          TEXT        PRIMARY KEY CHECK (key ~ '^[a-z0-9-]+$'),
  label        TEXT        NOT NULL,
  article_ids  UUID[]      NOT NULL CHECK (cardinality(article_ids) > 0),
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.stock_pools IS
  'Grupos de artículos de HWToolbox (hw_staging.hw_articles.article_id) que satisfacen un mismo componente del catálogo. Stock del pool = unidades nuevas disponibles de todos sus artículos.';
COMMENT ON COLUMN public.stock_pools.article_ids IS
  'UUID de hw_staging.hw_articles en el proyecto de inventario. Sin FK: otro proyecto. Un modelo nuevo en HWToolbox no cuenta hasta que se añade aquí.';

-- -------------------------------------------------------------
-- 2. Componentes de stock de cada producto
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_stock_components (
  product_code TEXT    NOT NULL REFERENCES public.products (code) ON UPDATE CASCADE,
  pool_key     TEXT    NOT NULL REFERENCES public.stock_pools (key) ON UPDATE CASCADE,
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (product_code, pool_key)
);

COMMENT ON TABLE public.product_stock_components IS
  'De qué pools tira cada producto y cuántas unidades por cada unidad vendida. Packs = varias filas. Producto físico sin filas = sin stock para no-admin.';

-- -------------------------------------------------------------
-- 3. RLS: lectura para autenticados (el mapeo no es sensible),
--    escritura solo admin. La app lee con service role.
-- -------------------------------------------------------------
ALTER TABLE public.stock_pools              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_pools: authenticated read" ON public.stock_pools;
CREATE POLICY "stock_pools: authenticated read" ON public.stock_pools
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "stock_pools: admin full" ON public.stock_pools;
CREATE POLICY "stock_pools: admin full" ON public.stock_pools FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "product_stock_components: authenticated read" ON public.product_stock_components;
CREATE POLICY "product_stock_components: authenticated read" ON public.product_stock_components
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "product_stock_components: admin full" ON public.product_stock_components;
CREATE POLICY "product_stock_components: admin full" ON public.product_stock_components FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- -------------------------------------------------------------
-- 4. Pools (artículos de HWToolbox a 2026-10-15)
-- -------------------------------------------------------------
INSERT INTO public.stock_pools (key, label, article_ids, notes) VALUES
  ('tpv-esencial',   'TPV Esencial (XPOS i5)',
     ARRAY['8cf90321-46d5-4e7b-a3bc-0e4016da20a0']::uuid[],
     'XPOS POS XPOS I5'),
  ('tpv-estandar',   'TPV Standard (Syrion)',
     ARRAY['92f88a06-00bb-4fe5-a09d-a4e20bca7f5d']::uuid[],
     'XPOS SYRION I5'),
  ('tpv-pro',        'TPV Pro (Aqprox appTPV05 / 10POS)',
     ARRAY['32e9229b-c80a-4fc7-9553-2d2bf50c6f3b',
           '0036a0d1-968b-49d4-89a4-ce2d024c698c',
           'e179a326-5b6c-4b46-a077-1ac7cbcc37be']::uuid[],
     '10POS 10T-16J648128W1, 10POS 10T-15J648128W1, Aqprox APPTPV05+G8. Fuera a propósito: unidades sueltas de otras marcas (Elines, TLM, Sunmi, ITS M6...).'),
  ('tpv-premium',    'TPV Premium (Jassway Galia)',
     ARRAY['0bbdadf5-5b9d-4003-877b-d7a5c07025de',
           '8283dde4-bd83-4967-b5e2-7bc3a906ef92',
           'd6c8ad8c-10ab-4768-91af-0c10d04a21c2']::uuid[],
     'Jassway GALIA, GALIA i5, GALIA Qamarero'),
  ('kds-pro',        'KDS Pro (10POS i5)',
     ARRAY['041bea1b-07f9-48a2-9d61-5e728a339c8d']::uuid[],
     '10POS 10D-22I58128W1. Pendiente de confirmar que es el KDS Pro del catálogo.'),
  ('kds-10pos-215',  'KDS 10POS 21,5" J6412',
     ARRAY['392dab2e-34c5-44dc-8d36-8df73caa00c8']::uuid[],
     '10POS 10D-215J68128W1 (KDS Canarias)'),
  ('tablet',         'Tablet Lenovo Tab Plus',
     ARRAY['70c73bd6-9c69-430a-992e-93656331431a']::uuid[],
     NULL),
  ('printer-usblan', 'Impresora USB/LAN',
     ARRAY['8bc5574a-94d1-4e14-b70a-04f8f77baa92',
           '8d01519d-667e-41f1-9f62-56336e091ef2',
           '847ba73b-bf6b-44ec-bba7-ace35f28de07']::uuid[],
     'ITS Tabby (no WiFi), 10POS RP-12N, Aqprox appPOS80AM-USBLAN. La de alarma de cocina va en su propio pool.'),
  ('printer-cocina', 'Impresora con alarma de cocina',
     ARRAY['ef2533f3-ce86-4960-a557-f938d236b522']::uuid[],
     'Aqprox AppPOS80ALARM'),
  ('printer-wifi',   'Impresora WiFi',
     ARRAY['f15c64c5-4d08-4430-841c-e3c65fda8268',
           'd9cf4b75-324a-460c-a384-e6cd601d31ef',
           '582d5aab-c241-4774-be46-5c6e63cdecb4']::uuid[],
     'Aqprox appPOS80USB+WIFI, 10POS RP-12NW, ITS Tabby WiFi'),
  ('printer-tp808',  'Impresora HPRT TP808',
     ARRAY['f0827114-dbfb-4845-bf8f-3871bbcea4e9']::uuid[],
     NULL),
  ('cajon',          'Cajón portamonedas',
     ARRAY['b0dfb606-1a1b-4ad3-baec-589d4b3397d3',
           '092b8837-48ce-4f90-b186-462e4a4faca0',
           '9d209d77-09ce-4078-80ce-88eb85e3bbf9',
           'a1d8bfb6-7771-4555-8abd-f9d0ebee0062']::uuid[],
     'ITS CD-4141, Aqprox appCASH01, 10POS CP-405N, 10POS CP-410N'),
  ('router-opal',    'Enrutador GL.iNet Opal',
     ARRAY['1f6fe349-1fe0-4e1b-b8e2-f21b3f21664a']::uuid[],
     NULL),
  ('router-flint',   'Enrutador GL.iNet Flint',
     ARRAY['f2d5a50e-2937-4559-ba5f-a575ec35b6af']::uuid[],
     'Flint 1'),
  ('balanza',        'Báscula Minerva 15 kg',
     ARRAY['17b8da38-80b7-4056-a5ea-0e8f4e6e768f']::uuid[],
     'MINERVA 56PPI-15'),
  ('avisadores-aqprox', 'Avisadores Aqprox · kit 10',
     ARRAY['778713e3-b0d0-4c51-9610-10bf9244d236']::uuid[],
     'Aqprox appCUSTOMERCALLERKIT')
ON CONFLICT (key) DO UPDATE
  SET label       = EXCLUDED.label,
      article_ids = EXCLUDED.article_ids,
      notes       = EXCLUDED.notes,
      updated_at  = NOW();

-- -------------------------------------------------------------
-- 5. Componentes por producto (reescritura completa del mapeo)
--    Canarias tira de los mismos pools: mismo almacén.
-- -------------------------------------------------------------
DELETE FROM public.product_stock_components;

INSERT INTO public.product_stock_components (product_code, pool_key, quantity) VALUES
  -- Packs
  ('pack-esencial',          'tpv-esencial',   1),
  ('pack-esencial',          'printer-usblan', 1),
  ('pack-esencial',          'cajon',          1),
  ('pack-basic',             'tpv-estandar',   1),
  ('pack-basic',             'printer-usblan', 1),
  ('pack-basic',             'cajon',          1),
  ('pack-pro',               'tpv-pro',        1),
  ('pack-pro',               'printer-usblan', 1),
  ('pack-pro',               'printer-wifi',   1),
  ('pack-pro',               'cajon',          1),
  ('pack-pro',               'router-opal',    1),
  ('pack-premium',           'tpv-premium',    1),
  ('pack-premium',           'printer-wifi',   2),
  ('pack-premium',           'cajon',          1),
  ('pack-premium',           'router-flint',   1),
  ('pack-cocina-digital',    'tpv-pro',        1),
  ('pack-cocina-digital',    'tablet',         1),
  ('pack-cocina-digital',    'printer-usblan', 1),
  ('pack-cocina-digital',    'cajon',          1),
  -- TPV
  ('tpv-estandar',           'tpv-estandar',   1),
  ('tpv-pro',                'tpv-pro',        1),
  ('tpv-premium',            'tpv-premium',    1),
  -- KDS
  ('tablet-kds-lenovo',      'tablet',         1),
  ('kds-pro',                'kds-pro',        1),
  -- Impresoras
  ('printer-cable',          'printer-usblan', 1),
  ('printer-wifi',           'printer-wifi',   1),
  ('printer-tp808-wifi',     'printer-tp808',  1),
  ('printer-cocina-usb-lan', 'printer-cocina', 1),
  -- Periféricos y red
  ('cajon',                  'cajon',          1),
  ('bascula-minerva-15',     'balanza',        1),
  ('avisadores-aqprox',      'avisadores-aqprox', 1),
  ('router-opal',            'router-opal',    1),
  ('router-flint',           'router-flint',   1),
  -- Canarias
  ('pack-basic-canarias',    'tpv-pro',        1),
  ('pack-basic-canarias',    'printer-usblan', 1),
  ('pack-basic-canarias',    'cajon',          1),
  ('pack-pro-canarias',      'tpv-pro',        1),
  ('pack-pro-canarias',      'printer-usblan', 1),
  ('pack-pro-canarias',      'printer-wifi',   1),
  ('pack-pro-canarias',      'cajon',          1),
  ('pack-premium-canarias',  'tpv-pro',        1),
  ('pack-premium-canarias',  'printer-wifi',   2),
  ('pack-premium-canarias',  'cajon',          1),
  ('tpv-pro-canarias',       'tpv-pro',        1),
  ('kds-canarias',           'kds-10pos-215',  1),
  ('printer-cable-canarias', 'printer-usblan', 1),
  ('printer-wifi-canarias',  'printer-wifi',   1),
  ('cajon-canarias',         'cajon',          1);

-- -------------------------------------------------------------
-- 6. Comprometido: unidades vendidas en MainOps que HWToolbox aún no
--    ha descontado. Devuelve la DEMANDA por pedido y producto; la app le
--    resta las salidas que HWToolbox ya registró para ese operation_id.
--
--    Cuentan:
--      * abiertos (nuevo, pendiente, falta_informacion, pagado): todo;
--      * enviado: si pasó a enviado hace <= p_enviado_dias (status_history;
--        sin historial, updated_at). Mientras reserva, la página de stock lo
--        lista como "enviado con salida pendiente"; pasado el plazo se da
--        por registrado y deja de reservar.
--    No cuentan: enviado_proveedor (sale del proveedor), bloqueado,
--    completado.
--    Solo líneas de productos con componentes de stock.
--
--    status se compara como TEXT: el enum se rehízo a mano en producción y
--    un literal que no exista en él rompería la función entera.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_commitments(p_enviado_dias INTEGER DEFAULT 15)
RETURNS TABLE (
  operation_id TEXT,
  status       TEXT,
  product_code TEXT,
  qty          BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH enviado_en AS (
    SELECT sh.order_id, max(sh.changed_at) AS enviado_at
      FROM public.status_history sh
     WHERE sh.to_status::text = 'enviado'
     GROUP BY sh.order_id
  )
  SELECT o.operation_id,
         o.status::text,
         p.code,
         sum(oi.qty)::bigint
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p     ON p.id = oi.product_id
    LEFT JOIN enviado_en e     ON e.order_id = o.id
   WHERE EXISTS (SELECT 1 FROM public.product_stock_components c
                  WHERE c.product_code = p.code)
     AND (
           o.status::text IN ('nuevo', 'pendiente', 'falta_informacion', 'pagado')
        OR (o.status::text = 'enviado'
            AND COALESCE(e.enviado_at, o.updated_at)
                >= NOW() - make_interval(days => p_enviado_dias))
     )
   GROUP BY o.operation_id, o.status, p.code;
$fn$;

COMMENT ON FUNCTION public.get_stock_commitments(INTEGER) IS
  'Demanda de stock por pedido abierto o enviado reciente (sin restar salidas de HWToolbox, eso lo hace la app). Solo service_role.';

REVOKE ALL ON FUNCTION public.get_stock_commitments(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_commitments(INTEGER) TO service_role;

-- -------------------------------------------------------------
-- 7. order_items: solo admin escribe DIRECTO (PostgREST con su sesión).
--    RESTRICTIVE se combina con AND sobre las políticas permisivas que ya
--    haya, así que cierra el hueco sin tocar ni conocer sus nombres
--    (commercial insert own, hardware full...). La app no se ve afectada:
--    sus rutas escriben con service role, que se salta RLS. DELETE se
--    mantiene: la ficha del pedido borra líneas con la sesión de hardware.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "order_items: solo admin inserta directo" ON public.order_items;
CREATE POLICY "order_items: solo admin inserta directo" ON public.order_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "order_items: solo admin modifica directo" ON public.order_items;
CREATE POLICY "order_items: solo admin modifica directo" ON public.order_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

COMMIT;

-- -------------------------------------------------------------
-- 8. Comprobación: cada producto activo y de dónde sale su stock.
--    Esperado: los 4 sin mapeo son kds-estandar, kds-premium,
--    sensor-temperatura y sensor-temperatura-receptor; los servicios y
--    'otro' salen como "sin control".
-- -------------------------------------------------------------
SELECT p.code,
       p.name,
       p.region,
       COALESCE(
         string_agg(c.pool_key || CASE WHEN c.quantity > 1 THEN ' ×' || c.quantity ELSE '' END,
                    ' + ' ORDER BY c.pool_key),
         CASE WHEN p.category IN ('service', 'custom')
              THEN '(sin control: servicio)'
              ELSE '⚠ SIN MAPEO: bloqueado para no-admin' END
       ) AS stock_desde
  FROM public.products p
  LEFT JOIN public.product_stock_components c ON c.product_code = p.code
 WHERE p.active
 GROUP BY p.code, p.name, p.region, p.category, p.sort_order
 ORDER BY p.sort_order, p.code;
