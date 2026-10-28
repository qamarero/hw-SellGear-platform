-- =============================================================================
-- Alta del lector inalámbrico Approx APPLS21WS en MainOperations.
-- Precio de catálogo: 40,46 EUR sin IVA (coste 28,90 EUR x margen 40 %).
-- La imagen se entrega junto a la app en:
--   apps/web/public/products/lector-codigos-approx-appls21ws.png
-- Migración aditiva e idempotente: puede aplicarse más de una vez sin duplicar
-- el SKU y deja la ficha alineada con el catálogo comercial.
-- =============================================================================

BEGIN;

INSERT INTO public.products (
  code,
  catalog_slug,
  name,
  description,
  category,
  region,
  price_cents,
  sort_order,
  brand,
  model,
  badge,
  summary,
  ideal_for,
  internal_note,
  availability_note,
  model_availability_note,
  image_url,
  highlights,
  components,
  specifications,
  price_breakdown,
  model_options,
  vat_rate,
  package_count,
  active,
  pricing_mode,
  allows_discount
) VALUES (
  'lector-codigos-approx-appls21ws',
  'lector-codigos-approx-appls21ws',
  'Lector inalámbrico de códigos 1D/2D',
  'Escáner inalámbrico Approx para códigos de barras 1D y 2D, incluidos QR, con receptor USB.',
  'accessory',
  'peninsula',
  4046,
  550,
  'Approx',
  'APPLS21WS',
  NULL,
  'Escáner inalámbrico para leer códigos de barras 1D y 2D, incluidos QR.',
  'Locales que necesitan escanear productos en caja sin cable y con lectura automática o manual.',
  NULL,
  NULL,
  NULL,
  '/products/lector-codigos-approx-appls21ws.png',
  ARRAY[
    'Lectura de códigos 1D y 2D',
    'Conexión inalámbrica 2,4 GHz',
    'Hasta 60 m de alcance',
    'Lectura automática o manual'
  ],
  ARRAY[]::TEXT[],
  '[
    {"label":"Tecnología","value":"Lector de área · resolución 640 × 480"},
    {"label":"Códigos","value":"1D y 2D, incluidos EAN, Code 128, PDF417 y QR"},
    {"label":"Conectividad","value":"Radiofrecuencia 2,4 GHz · receptor USB"},
    {"label":"Alcance","value":"Hasta 60 m según ficha del fabricante"},
    {"label":"Autonomía","value":"Hasta 25 h · batería de 2.000 mAh"},
    {"label":"Protección","value":"IP42"},
    {"label":"Peso","value":"173 g aprox."},
    {"label":"Contenido","value":"Lector APPLS21WS, cable y guía de usuario"}
  ]'::JSONB,
  NULL,
  NULL,
  21.00,
  1,
  TRUE,
  'catalog',
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  catalog_slug = EXCLUDED.catalog_slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  region = EXCLUDED.region,
  price_cents = EXCLUDED.price_cents,
  sort_order = EXCLUDED.sort_order,
  brand = EXCLUDED.brand,
  model = EXCLUDED.model,
  badge = EXCLUDED.badge,
  summary = EXCLUDED.summary,
  ideal_for = EXCLUDED.ideal_for,
  internal_note = EXCLUDED.internal_note,
  availability_note = EXCLUDED.availability_note,
  model_availability_note = EXCLUDED.model_availability_note,
  image_url = EXCLUDED.image_url,
  highlights = EXCLUDED.highlights,
  components = EXCLUDED.components,
  specifications = EXCLUDED.specifications,
  price_breakdown = EXCLUDED.price_breakdown,
  model_options = EXCLUDED.model_options,
  vat_rate = EXCLUDED.vat_rate,
  package_count = EXCLUDED.package_count,
  active = EXCLUDED.active,
  pricing_mode = EXCLUDED.pricing_mode,
  allows_discount = EXCLUDED.allows_discount;

COMMIT;

-- Comprobación posterior a la aplicación:
-- SELECT code, catalog_slug, price_cents, category, image_url, active
-- FROM public.products
-- WHERE code = 'lector-codigos-approx-appls21ws';
