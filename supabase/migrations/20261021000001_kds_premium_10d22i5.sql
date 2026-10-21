-- =============================================================
-- Control de stock: el 10POS 10D-22I5 es el KDS PREMIUM, no el KDS Pro.
--
-- 20261015000001 lo puso en un pool `kds-pro` "pendiente de confirmar" y se
-- lo asignó al KDS Pro. Confirmado (2026-10-21) que es el KDS Premium:
--   1. el pool pasa a llamarse `kds-premium` (la FK de
--      product_stock_components tiene ON UPDATE CASCADE, así que sigue
--      enlazado);
--   2. el KDS Pro deja de tirar de él y el KDS Premium pasa a hacerlo.
--
-- El KDS Pro se queda sin artículo de almacén. Tiene supplier_fallback
-- (20261016000001), así que no se bloquea: va entero a proveedor hasta que
-- se le asigne su modelo de HWToolbox.
--
-- OJO: 20261015000001 reescribe product_stock_components entera con el
-- mapeo viejo. Si se re-ejecuta, pegar esta (y 20261016000002) después.
--
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- IDEMPOTENTE.
-- =============================================================

BEGIN;

UPDATE public.stock_pools
   SET key        = 'kds-premium',
       label      = 'KDS Premium (10POS i5)',
       notes      = '10POS 10D-22I58128W1. Confirmado como KDS Premium el 2026-10-21.',
       updated_at = NOW()
 WHERE key = 'kds-pro';

DELETE FROM public.product_stock_components
 WHERE product_code = 'kds-pro';

INSERT INTO public.product_stock_components (product_code, pool_key, quantity)
VALUES ('kds-premium', 'kds-premium', 1)
ON CONFLICT (product_code, pool_key) DO NOTHING;

COMMIT;

-- -------------------------------------------------------------
-- Comprobación. Esperado:
--   kds-pro     | (sin artículo: a proveedor) | true
--   kds-premium | kds-premium                  | true
-- -------------------------------------------------------------
SELECT p.code,
       p.name,
       COALESCE(string_agg(c.pool_key, ' + '), '(sin artículo: a proveedor)') AS stock_desde,
       p.supplier_fallback
  FROM public.products p
  LEFT JOIN public.product_stock_components c ON c.product_code = p.code
 WHERE p.code IN ('kds-pro', 'kds-premium')
 GROUP BY p.code, p.name, p.supplier_fallback, p.sort_order
 ORDER BY p.sort_order;
