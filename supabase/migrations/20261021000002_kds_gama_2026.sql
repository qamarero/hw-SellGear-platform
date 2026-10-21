-- =============================================================
-- Gama KDS 2026: igual que el catálogo web (hw-qamarero-catalog ecfd978).
--
--   * Se retira el KDS Premium antiguo (10POS, IP54, 500 nits, J6412 o
--     Raptor Lake, 1.383 €).
--   * El KDS con Core i5-8250U (antes «KDS Pro», 963 €) pasa a llamarse
--     KDS Premium. Precio y specs no cambian.
--   * KDS Pro nuevo: 10POS 10D-21, Intel J6412, IP65, fanless, 693 €.
--
-- Se hace como en la web: los `code` (kds-pro, kds-premium) se quedan con su
-- nombre y su FOTO, y lo que cambia es el equipo que describe cada uno. Por
-- eso no hay INSERT ni baja de fila: el KDS Premium antiguo desaparece al
-- quedar sustituido. Los pedidos históricos no se alteran: order_items guarda
-- snapshot de nombre, precio e IVA.
--
-- Textos (resumen, ideal para, highlights, specs, badge, nota interna)
-- copiados de lib/catalog.ts del catálogo web. KDS Pro lleva además la fila
-- «Diseño: fanless» que pidió negocio.
--
-- Stock:
--   * KDS Premium sigue con el pool kds-premium (10POS 10D-22I5 = el Core i5,
--     20261021000001).
--   * KDS Pro pasa a usar el 10POS 10D-215J68128W1 (J6412): se renombra su
--     pool, que solo usaba el KDS Canarias antes de 20261016000002.
--   Los dos siguen con supplier_fallback: sin stock, a proveedor.
--
-- La financiación de los dos va en código (apps/web/lib/financing.ts).
--
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- IDEMPOTENTE.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. KDS Premium = el Core i5 (antes KDS Pro). Conserva kds-premium.webp.
-- -------------------------------------------------------------
UPDATE public.products SET
    catalog_slug            = 'kds-premium'
  , name                    = 'KDS Premium'
  , category                = 'kds'
  , region                  = 'peninsula'
  , price_cents             = 96300
  , sort_order              = 340
  , brand                   = '10POS'
  , model                   = NULL
  , badge                   = 'Premium'
  , summary                 = 'Terminal industrial de cocina con panel táctil sellado (IP65) y procesador Intel Core i5 para la máxima fluidez.'
  , ideal_for               = 'Cocinas con carga intensa que necesitan pantalla grande, montaje mural y panel protegido.'
  , internal_note           = 'IP65 en el panel frontal: resiste salpicaduras, vapor y limpieza con paño húmedo, por lo que sí puede colocarse cerca de freidoras, ollas u otras fuentes de vapores (al contrario que el KDS Standard). La protección cubre el frontal, no toda la carcasa.'
  , availability_note       = NULL
  , model_availability_note = NULL
  , highlights              = ARRAY['Intel Core i5', '21,5" Full HD', 'IP65 en panel']::text[]
  , components              = '{}'
  , specifications          = '[{"label": "Pantalla", "value": "21,5\" táctil Full HD"}, {"label": "Resolución", "value": "1.920 × 1.080"}, {"label": "Procesador", "value": "Intel Core i5-8250U 8ª Gen · hasta 3,40 GHz"}, {"label": "Memoria", "value": "8 GB DDR4 · 128 GB SSD"}, {"label": "Conectividad", "value": "Wi‑Fi · Ethernet Gigabit · 2 USB 3.0 · 2 USB 2.0 · 2 RS232 · HDMI"}, {"label": "Sistema", "value": "Windows 11 incluido"}, {"label": "Protección", "value": "IP65 en panel"}, {"label": "Montaje", "value": "VESA 100 × 100 · sobremesa o encastrado opcionales"}]'::jsonb
  , price_breakdown         = NULL
  , model_options           = NULL
  , description             = 'Pantalla cocina 21,5'''' Full HD táctil. Intel Core i5-8250U, 8GB DDR4 + 128GB SSD. WiFi + Gigabit + 2 USB 3.0 + 2 USB 2.0 + 2 RS232 + HDMI. Windows 11. IP65 en panel. VESA 100x100.'
 WHERE code = 'kds-premium';

-- -------------------------------------------------------------
-- 2. KDS Pro = nuevo 10POS 10D-21 (J6412). Conserva kds-pro.webp.
-- -------------------------------------------------------------
UPDATE public.products SET
    catalog_slug            = 'kds-pro'
  , name                    = 'KDS Pro'
  , category                = 'kds'
  , region                  = 'peninsula'
  , price_cents             = 69300
  , sort_order              = 330
  , brand                   = '10POS'
  , model                   = '10D-21'
  , badge                   = 'Mejor valor'
  , summary                 = 'Terminal industrial de cocina fanless con panel capacitivo sellado (IP65) y Windows 11 IoT.'
  , ideal_for               = 'Cocinas que necesitan una pantalla grande y resistente a salpicaduras y vapor sin disparar el presupuesto.'
  , internal_note           = 'IP65 en el panel frontal: resiste salpicaduras, vapor y limpieza con paño húmedo, por lo que sí puede colocarse cerca de freidoras, ollas u otras fuentes de vapores (al contrario que el KDS Standard). La protección cubre el frontal, no toda la carcasa.'
  , availability_note       = NULL
  , model_availability_note = NULL
  , highlights              = ARRAY['Intel J6412 fanless', '21,5" Full HD · 300 nits', 'IP65 en panel']::text[]
  , components              = '{}'
  , specifications          = '[{"label": "Pantalla", "value": "21,5\" táctil capacitivo Full HD"}, {"label": "Resolución", "value": "1.920 × 1.080"}, {"label": "Procesador", "value": "Intel J6412 · 2,60 GHz · 1,5 MB caché"}, {"label": "Memoria", "value": "8 GB RAM · 128 GB SSD"}, {"label": "Conectividad", "value": "WiFi · Bluetooth"}, {"label": "Sistema", "value": "Windows 11 IoT"}, {"label": "Brillo", "value": "300 nits"}, {"label": "Protección", "value": "IP65 en panel"}, {"label": "Diseño", "value": "Fanless, sin ventilador"}, {"label": "Garantía", "value": "2 años"}]'::jsonb
  , price_breakdown         = NULL
  , model_options           = NULL
  , description             = 'Pantalla cocina 21,5'''' Full HD táctil capacitiva, 300 nits. Intel J6412 2,60 GHz, 8GB RAM + 128GB SSD. WiFi + Bluetooth. Windows 11 IoT. IP65 en panel. Fanless. Garantía 2 años.'
 WHERE code = 'kds-pro';

-- -------------------------------------------------------------
-- 3. Stock del KDS Pro: el 10D-215J68128W1 (J6412).
--    El pool kds-10pos-215 pasa a llamarse kds-pro (la FK de
--    product_stock_components tiene ON UPDATE CASCADE).
-- -------------------------------------------------------------
UPDATE public.stock_pools
   SET key        = 'kds-pro',
       label      = 'KDS Pro (10POS 10D-21 J6412)',
       notes      = '10POS 10D-215J68128W1. Confirmado como KDS Pro el 2026-10-21 (antes lo usaba el KDS Canarias).',
       updated_at = NOW()
 WHERE key = 'kds-10pos-215';

INSERT INTO public.product_stock_components (product_code, pool_key, quantity)
VALUES ('kds-pro', 'kds-pro', 1)
ON CONFLICT (product_code, pool_key) DO NOTHING;

COMMIT;

-- -------------------------------------------------------------
-- 4. Comprobación. Esperado:
--   kds-pro     | KDS Pro     | 69300 | Mejor valor | /products/kds-pro.webp     | kds-pro     | true
--   kds-premium | KDS Premium | 96300 | Premium     | /products/kds-premium.webp | kds-premium | true
-- -------------------------------------------------------------
SELECT p.code,
       p.name,
       p.price_cents,
       p.badge,
       p.image_url,
       COALESCE(string_agg(c.pool_key, ' + '), '(sin artículo)') AS stock_desde,
       p.supplier_fallback
  FROM public.products p
  LEFT JOIN public.product_stock_components c ON c.product_code = p.code
 WHERE p.code IN ('kds-pro', 'kds-premium')
 GROUP BY p.code, p.name, p.price_cents, p.badge, p.image_url, p.supplier_fallback, p.sort_order
 ORDER BY p.sort_order;
