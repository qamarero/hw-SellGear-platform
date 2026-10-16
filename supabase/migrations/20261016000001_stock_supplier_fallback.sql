-- =============================================================
-- Control de stock: productos que, sin stock, se piden a proveedor.
--
-- Algunos equipos nunca se bloquean por stock: si en el almacén no hay
-- unidades suficientes, se encargan directamente al proveedor. Se sirve
-- SIEMPRE primero del almacén y solo lo que falta va a proveedor
-- (1 en stock y 3 pedidas = 1 del almacén + 2 a proveedor).
--
--   1. products.supplier_fallback  qué productos pueden ir a proveedor.
--   2. order_items.supplier_qty    cuántas unidades de la línea van a
--                                  proveedor. Lo fija la app al crear la
--                                  línea; viaja también en la nota de la
--                                  línea para quien prepara el pedido.
--   3. get_stock_commitments()     reserva solo qty − supplier_qty: lo que
--                                  va a proveedor no ocupa stock del
--                                  almacén (si no, un Pack Premium encargado
--                                  a proveedor seguiría bloqueando cajones e
--                                  impresoras que otros productos necesitan).
--
-- ORDEN DE APLICACIÓN — IMPORTANTE: este SQL ANTES de desplegar el código.
-- El código nuevo inserta order_items.supplier_qty; sin la columna, el
-- insert de líneas fallaría y el pedido se crearía vacío.
--
-- Requiere 20261015000001_stock_control.sql aplicada.
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- IDEMPOTENTE.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Productos con respaldo de proveedor
-- -------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_fallback BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.products.supplier_fallback IS
  'TRUE = sin stock suficiente en el almacén se pide a proveedor: nunca se bloquea por stock. Se sirve primero del almacén y el resto va a order_items.supplier_qty.';

-- Solo marca: no desmarca nada, para que volver a pegar este fichero no
-- deshaga productos que se marquen más adelante a mano.
UPDATE public.products
   SET supplier_fallback = TRUE
 WHERE NOT supplier_fallback
   AND code IN (
         'pack-premium',
         'sensor-temperatura',
         'sensor-temperatura-receptor',
         'avisadores-aqprox',
         'avisadores-10pos',
         'bascula-minerva-15',
         'kds-pro',
         'kds-premium'
       );

-- -------------------------------------------------------------
-- 2. Unidades de cada línea que van a proveedor
-- -------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS supplier_qty INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_supplier_qty_chk;
ALTER TABLE public.order_items ADD  CONSTRAINT order_items_supplier_qty_chk
  CHECK (supplier_qty >= 0 AND supplier_qty <= qty);

COMMENT ON COLUMN public.order_items.supplier_qty IS
  'Unidades de la línea que se encargan a proveedor por falta de stock (productos con supplier_fallback). No reservan stock del almacén: get_stock_commitments cuenta qty − supplier_qty.';

-- -------------------------------------------------------------
-- 3. Comprometido: solo lo que sale del almacén
--    Misma firma y mismas reglas que en 20261015000001; cambia solo que
--    cada línea aporta qty − supplier_qty.
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
         sum(oi.qty - oi.supplier_qty)::bigint
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p     ON p.id = oi.product_id
    LEFT JOIN enviado_en e     ON e.order_id = o.id
   WHERE EXISTS (SELECT 1 FROM public.product_stock_components c
                  WHERE c.product_code = p.code)
     AND oi.qty > oi.supplier_qty
     AND (
           o.status::text IN ('nuevo', 'pendiente', 'falta_informacion', 'pagado')
        OR (o.status::text = 'enviado'
            AND COALESCE(e.enviado_at, o.updated_at)
                >= NOW() - make_interval(days => p_enviado_dias))
     )
   GROUP BY o.operation_id, o.status, p.code;
$fn$;

COMMENT ON FUNCTION public.get_stock_commitments(INTEGER) IS
  'Demanda de stock del almacén (qty − supplier_qty) por pedido abierto o enviado reciente, sin restar salidas de HWToolbox (eso lo hace la app). Solo service_role.';

REVOKE ALL ON FUNCTION public.get_stock_commitments(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_commitments(INTEGER) TO service_role;

COMMIT;

-- -------------------------------------------------------------
-- 4. Comprobación: los productos marcados.
--    Esperado: 8 filas (avisadores-10pos sale aunque esté inactivo).
-- -------------------------------------------------------------
SELECT code, name, active, supplier_fallback
  FROM public.products
 WHERE supplier_fallback
 ORDER BY sort_order, code;
