-- =============================================================
-- Control de stock de MainOps: funciones de LECTURA en el proyecto de
-- inventario (olcxbtvjkjmofrbvzpat) — NO en el principal.
--
-- MainOps calcula: stock pedible = disponible − comprometido. Para ello
-- necesita dos cosas de HWToolbox, que expone con estas funciones:
--
--   get_stock_by_article()        unidades nuevas disponibles por artículo.
--   get_mainops_exits(text[])     unidades que HWToolbox ya dio de salida
--                                 para cada pedido HW-YYYYMM-NNNN. Es lo que
--                                 libera la reserva de un pedido enviado.
--
-- Mismo patrón que get_inventory_by_type (inventory_project_setup.sql):
-- SECURITY DEFINER sobre hw_staging, llamadas desde el servidor de Next.js
-- con la service_role key. A diferencia de aquella, NO se conceden a
-- anon/authenticated: solo service_role.
--
-- Aplicación: pegar en el SQL Editor del proyecto olcxbtvjkjmofrbvzpat
-- (https://supabase.com/dashboard/project/olcxbtvjkjmofrbvzpat/sql/new).
-- Solo crea funciones de lectura: no toca ninguna tabla. IDEMPOTENTE.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Disponible por artículo: nuevo y disponible, como /inventory.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_by_article()
RETURNS TABLE (
  article_id         UUID,
  disponibles_nuevos BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, hw_staging
AS $fn$
  SELECT i.article_id,
         count(*)::bigint
    FROM hw_staging.hw_inventory i
   WHERE i.estado = 'disponible'
     AND i.condicion = 'nuevo'
     AND i.article_id IS NOT NULL
   GROUP BY i.article_id;
$fn$;

COMMENT ON FUNCTION public.get_stock_by_article() IS
  'Unidades nuevas y disponibles por article_id. La consume MainOps (control de stock) con service_role.';

-- -------------------------------------------------------------
-- 2. Salidas ya registradas por pedido de MainOps.
--    Cuenta números de serie de las transacciones enlazadas al pedido
--    (mainops_operation_id), por artículo. supplier_to_client entra
--    también: si un pedido 'enviado' se sirvió en parte desde proveedor,
--    esas unidades tampoco deben seguir reservadas.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mainops_exits(p_operation_ids TEXT[])
RETURNS TABLE (
  mainops_operation_id TEXT,
  article_id           UUID,
  unidades             BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, hw_staging
AS $fn$
  SELECT s.mainops_operation_id,
         i.article_id,
         count(*)::bigint
    FROM hw_staging.hw_shipments s
    JOIN hw_staging.hw_shipments_items si ON si.shipment_id = s.shipment_id
    JOIN hw_staging.hw_inventory i        ON i.numero_serie = si.numero_serie
   WHERE s.mainops_operation_id = ANY (p_operation_ids)
     AND s.tipo IN ('sent_client', 'supplier_to_client')
     AND i.article_id IS NOT NULL
   GROUP BY s.mainops_operation_id, i.article_id;
$fn$;

COMMENT ON FUNCTION public.get_mainops_exits(TEXT[]) IS
  'Unidades ya dadas de salida por pedido de MainOps (HW-YYYYMM-NNNN) y artículo. La consume MainOps para liberar reservas.';

-- -------------------------------------------------------------
-- 3. Permisos: solo service_role (la key vive en Vercel, server-side).
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_stock_by_article()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_mainops_exits(TEXT[])     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_by_article()     TO service_role;
GRANT EXECUTE ON FUNCTION public.get_mainops_exits(TEXT[])  TO service_role;

-- -------------------------------------------------------------
-- 4. Comprobación: total de unidades nuevas disponibles y salidas de los
--    últimos pedidos enlazados. Deben salir números, no errores.
-- -------------------------------------------------------------
SELECT
  (SELECT sum(disponibles_nuevos) FROM public.get_stock_by_article())      AS unidades_nuevas_disponibles,
  (SELECT count(*)                FROM public.get_stock_by_article())      AS articulos_con_stock,
  (SELECT sum(unidades) FROM public.get_mainops_exits(
     ARRAY(SELECT DISTINCT mainops_operation_id
             FROM hw_staging.hw_shipments
            WHERE mainops_operation_id IS NOT NULL
            ORDER BY mainops_operation_id DESC
            LIMIT 20)))                                                    AS unidades_salidas_ultimos_20_pedidos;
