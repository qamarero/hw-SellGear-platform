-- =============================================================
-- Sensores de temperatura doBBox: rango de medición en la ficha.
--
-- Dato de la hoja técnica del fabricante: rango de -40 °C a 70 °C. Se
-- añade como fila «Rango de temperatura» justo después de «Medición» en
-- los dos formatos (con receptor y solo sensor).
--
-- specifications es un ARRAY jsonb con orden curado, así que se reescribe
-- entero en vez de insertar en una posición: así se ve el resultado final.
--
-- IDEMPOTENTE: el UPDATE solo escribe si el valor cambia, así que pegarlo
-- dos veces no dispara el trigger de updated_at.
-- Requiere 20261014000001 aplicada. Aplicación manual en Supabase SQL Editor.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Precondición
-- -------------------------------------------------------------
DO $guard$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.products
   WHERE code IN ('sensor-temperatura-receptor', 'sensor-temperatura');
  IF n <> 2 THEN
    RAISE EXCEPTION
      'Solo existen % de los 2 sensores de temperatura. Aplica antes 20261014000001_add_control_temperatura.sql.',
      n;
  END IF;
END
$guard$;

BEGIN;

-- -------------------------------------------------------------
-- 1. Fichas con el rango
-- -------------------------------------------------------------
WITH objetivo (code, specifications) AS (
  VALUES
    ('sensor-temperatura-receptor',
     '[{"label": "Contenido", "value": "1 sensor de temperatura + receptor doBBox"}, {"label": "Medición", "value": "Temperatura del interior de cámaras, neveras y congeladores"}, {"label": "Rango de temperatura", "value": "De -40 °C a 70 °C"}, {"label": "Conexión", "value": "El sensor envía las lecturas al receptor por Bluetooth (BLE)"}, {"label": "Receptor", "value": "Antena externa · indicadores de internet, BLE y encendido"}, {"label": "Ampliación", "value": "Admite sensores adicionales, que se venden por separado"}]'::jsonb),
    ('sensor-temperatura',
     '[{"label": "Medición", "value": "Temperatura"}, {"label": "Rango de temperatura", "value": "De -40 °C a 70 °C"}, {"label": "Conexión", "value": "Bluetooth (BLE) con el receptor doBBox"}, {"label": "Requisitos", "value": "Receptor doBBox, incluido en el Sensor de temperatura con receptor"}, {"label": "Uso", "value": "Interior de cámaras, neveras y congeladores"}]'::jsonb)
)
UPDATE public.products p
   SET specifications = o.specifications
  FROM objetivo o
 WHERE p.code = o.code
   AND p.specifications IS DISTINCT FROM o.specifications;

COMMIT;

-- -------------------------------------------------------------
-- 2. Comprobación: la ficha fila a fila, en el orden en que se pinta.
--    Esperado: 11 filas; «Rango de temperatura» en la posición 3 del
--    formato con receptor y en la 2 del sensor solo.
-- -------------------------------------------------------------
SELECT p.code, s.pos, s.e->>'label' AS label, s.e->>'value' AS value
  FROM public.products p
 CROSS JOIN LATERAL jsonb_array_elements(p.specifications) WITH ORDINALITY AS s(e, pos)
 WHERE p.code IN ('sensor-temperatura-receptor', 'sensor-temperatura')
 ORDER BY p.sort_order, s.pos;
