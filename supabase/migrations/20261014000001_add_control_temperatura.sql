-- =============================================================
-- Control de temperatura doBBox: un accesorio en dos formatos.
--
--   sensor-temperatura-receptor  Sensor de temperatura con receptor  295,00 EUR + IVA
--   sensor-temperatura           Sensor de temperatura               210,00 EUR + IVA
--
-- Decisiones:
--   * Es un ACCESORIO, no un pack: category = 'accessory' (pestaña
--     Periféricos). Se compra el conjunto (sensor + receptor) o el sensor
--     solo. Los relacionados de la ficha se calculan por category + region,
--     así que cada formato sugiere el otro.
--   * El receptor NO se vende suelto. Por eso no hay price_breakdown: no
--     existe un "por separado" que comparar, y sin desglose la tarjeta no
--     pinta el bloque de ahorro (PackComparison devuelve null).
--   * El sensor solo no funciona sin receptor: lo dice internal_note para el
--     comercial y specifications para la ficha.
--   * Solo peninsula. Sin SKU canario hasta que haya precio final para Canarias.
--   * No vienen del catálogo web (hw-qamarero-catalog): catalog_slug NULL.
--
-- Fotos: apps/web/public/products/sensor-temperatura{-receptor,}.webp. Tienen
-- que estar DESPLEGADAS antes de aplicar esto: si no, la tarjeta sale con la
-- imagen rota (image_url apunta a un fichero que aún no existe).
--
-- Requiere 20260825000001 (columnas de ficha) y 20260825000003 (CHECK de
-- category). Aplicación manual en Supabase SQL Editor.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Precondición
-- -------------------------------------------------------------
DO $guard$
DECLARE
  faltan_columnas text;
BEGIN
  SELECT string_agg(c, ', ')
    INTO faltan_columnas
    FROM unnest(ARRAY['region','pricing_mode','allows_discount','summary',
                      'ideal_for','badge','internal_note','image_url',
                      'highlights','components','specifications']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name = c
   );
  IF faltan_columnas IS NOT NULL THEN
    RAISE EXCEPTION
      'Falta aplicar 20260825000001_products_rich_metadata.sql: no existen las columnas %.',
      faltan_columnas;
  END IF;
END
$guard$;

BEGIN;

-- -------------------------------------------------------------
-- 1. Sensor de temperatura con receptor — el formato para empezar
-- -------------------------------------------------------------
INSERT INTO public.products (
    code, catalog_slug, name, description, category, region, price_cents, sort_order, brand, model, badge, summary, ideal_for, internal_note, availability_note, model_availability_note, image_url, highlights, components, specifications, price_breakdown, model_options, vat_rate, package_count, active
) VALUES (
    'sensor-temperatura-receptor',
    NULL,
    'Sensor de temperatura con receptor',
    'Control de temperatura doBBox: 1 sensor de temperatura + 1 receptor (gateway con antena externa). El sensor envía las lecturas al receptor por Bluetooth (BLE).',
    'accessory',
    'peninsula',
    29500,
    550,
    'doBBox',
    NULL,
    'Con receptor',
    'Controla la temperatura de cámaras, neveras y congeladores con un sensor y su receptor, listos para instalar.',
    'Locales que quieren vigilar la cadena de frío y dejar de apuntar a mano las temperaturas del APPCC.',
    'El receptor no se vende suelto: a un cliente que aún no tiene receptor véndele este formato. Para controlar más cámaras o neveras, añade Sensores de temperatura sin receptor.',
    NULL,
    NULL,
    '/products/sensor-temperatura-receptor.webp',
    ARRAY['Sensor + receptor', 'Conexión Bluetooth (BLE)', 'Cámaras, neveras y congeladores']::text[],
    ARRAY['Sensor de temperatura', 'Receptor doBBox con antena']::text[],
    '[{"label": "Contenido", "value": "1 sensor de temperatura + receptor doBBox"}, {"label": "Medición", "value": "Temperatura del interior de cámaras, neveras y congeladores"}, {"label": "Conexión", "value": "El sensor envía las lecturas al receptor por Bluetooth (BLE)"}, {"label": "Receptor", "value": "Antena externa · indicadores de internet, BLE y encendido"}, {"label": "Ampliación", "value": "Admite sensores adicionales, que se venden por separado"}]'::jsonb,
    NULL,
    NULL,
    21,
    1,
    TRUE
)
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------------
-- 2. Sensor de temperatura — solo el sensor, requiere receptor
-- -------------------------------------------------------------
INSERT INTO public.products (
    code, catalog_slug, name, description, category, region, price_cents, sort_order, brand, model, badge, summary, ideal_for, internal_note, availability_note, model_availability_note, image_url, highlights, components, specifications, price_breakdown, model_options, vat_rate, package_count, active
) VALUES (
    'sensor-temperatura',
    NULL,
    'Sensor de temperatura',
    'Sensor de temperatura doBBox (BLE), sin receptor. Necesita un receptor doBBox, que solo se vende con el Sensor de temperatura con receptor.',
    'accessory',
    'peninsula',
    21000,
    560,
    'doBBox',
    NULL,
    'Solo sensor',
    'Sensor para controlar otra cámara, nevera o congelador con el receptor doBBox que ya tiene el local.',
    'Locales con receptor doBBox que quieren vigilar más puntos de frío.',
    'No funciona sin receptor doBBox. Si el cliente todavía no lo tiene, vende el Sensor de temperatura con receptor.',
    NULL,
    NULL,
    '/products/sensor-temperatura.webp',
    ARRAY['Conexión Bluetooth (BLE)', 'Un sensor por punto de frío', 'Requiere receptor doBBox']::text[],
    '{}',
    '[{"label": "Medición", "value": "Temperatura"}, {"label": "Conexión", "value": "Bluetooth (BLE) con el receptor doBBox"}, {"label": "Requisitos", "value": "Receptor doBBox, incluido en el Sensor de temperatura con receptor"}, {"label": "Uso", "value": "Interior de cámaras, neveras y congeladores"}]'::jsonb,
    NULL,
    NULL,
    21,
    1,
    TRUE
)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- -------------------------------------------------------------
-- 3. Comprobación. Debe devolver 2 filas, activas, en Periféricos.
--    ON CONFLICT DO NOTHING no avisa: si el code ya existía con otros
--    datos, esto lo enseña.
-- -------------------------------------------------------------
SELECT code, name, category, region, price_cents, vat_rate, sort_order,
       active, image_url, cardinality(highlights) AS n_highlights
  FROM public.products
 WHERE code IN ('sensor-temperatura-receptor', 'sensor-temperatura')
 ORDER BY sort_order;
-- esperado:
--   sensor-temperatura-receptor | Sensor de temperatura con receptor | accessory | peninsula | 29500 | 21 | 550 | t | /products/sensor-temperatura-receptor.webp | 3
--   sensor-temperatura          | Sensor de temperatura              | accessory | peninsula | 21000 | 21 | 560 | t | /products/sensor-temperatura.webp          | 3
