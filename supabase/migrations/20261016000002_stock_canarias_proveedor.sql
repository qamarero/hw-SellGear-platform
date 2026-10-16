-- =============================================================
-- Control de stock: Canarias se sirve SIEMPRE desde proveedor.
--
-- Los pedidos a Canarias no salen de nuestro almacén: los envía un
-- proveedor. Así que los SKU canarios:
--   * se marcan supplier_fallback (nunca se bloquean por stock);
--   * pierden sus componentes de stock: no consumen ni reservan unidades del
--     almacén. Al quitarlos, get_stock_commitments deja de contar las líneas
--     canarias de los pedidos abiertos que hoy SÍ reservan (se crearon antes
--     de esta regla con supplier_qty = 0).
--
-- La app aplica además la regla por código (lib/stock/compute.ts,
-- isSupplierOnly: region = 'canarias' => todo a proveedor), así que un SKU
-- canario nuevo nace bien aunque nadie lo marque aquí.
--
-- OJO: 20261015000001 reescribe product_stock_components entera y volvería
-- a meter los componentes canarios. Si se re-ejecuta, pegar esta después.
--
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- Se puede aplicar antes o después de desplegar el código. IDEMPOTENTE.
-- =============================================================

BEGIN;

UPDATE public.products
   SET supplier_fallback = TRUE
 WHERE region = 'canarias'
   AND NOT supplier_fallback;

DELETE FROM public.product_stock_components c
 USING public.products p
 WHERE p.code = c.product_code
   AND p.region = 'canarias';

COMMIT;

-- -------------------------------------------------------------
-- Comprobación: todos los SKU canarios, marcados y sin componentes.
-- Esperado: 8 filas con supplier_fallback = true y componentes = 0.
-- -------------------------------------------------------------
SELECT p.code,
       p.name,
       p.active,
       p.supplier_fallback,
       (SELECT count(*) FROM public.product_stock_components c
         WHERE c.product_code = p.code) AS componentes
  FROM public.products p
 WHERE p.region = 'canarias'
 ORDER BY p.sort_order, p.code;
