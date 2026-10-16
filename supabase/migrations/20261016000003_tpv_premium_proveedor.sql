-- =============================================================
-- Control de stock: el TPV Premium suelto también se pide a proveedor.
--
-- Igual que el Pack Premium (20261016000001): si no hay stock en el
-- almacén, se encarga al proveedor en vez de bloquear el pedido. Se sirve
-- primero del almacén y lo que falta va a order_items.supplier_qty.
--
-- Solo datos: el código ya trata supplier_fallback. Aplicación manual en
-- Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush). IDEMPOTENTE.
-- =============================================================

UPDATE public.products
   SET supplier_fallback = TRUE
 WHERE code = 'tpv-premium'
   AND NOT supplier_fallback;

-- Comprobación. Esperado: 1 fila, supplier_fallback = true.
SELECT code, name, active, supplier_fallback
  FROM public.products
 WHERE code = 'tpv-premium';
