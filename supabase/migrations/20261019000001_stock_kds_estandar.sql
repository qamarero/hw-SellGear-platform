-- =============================================================
-- Control de stock: el KDS Standard (kds-estandar) tira del almacén.
--
-- 20261015000001 dejó kds-estandar sin componentes de stock, así que para
-- un no-admin salía "No disponible" aunque HWToolbox tuviera unidades: la
-- app no sabía en qué artículo buscarlo. En HWToolbox está dado de alta como:
--
--   UNICOPOS UNICO-W2164N  d14b93a7-7ae1-4650-a891-f89eb0bde0c1
--                          (entrada 632 "x3 kds estandar", 2026-10-16)
--   Pedro porto V022PTD02  35b17837-05fb-4687-a9b4-7314fab72a6b
--                          la misma pantalla dada de alta con otro nombre:
--                          su única unidad salió como "kds estandar" en
--                          HW-202608-2016. Entra para que sus salidas
--                          liberen la reserva del pedido; no suma stock.
--
-- Verificados contra hw_staging.hw_articles (proyecto olcxbtvjkjmofrbvzpat)
-- el 2026-10-19. kds-estandar NO es supplier_fallback: sin stock, bloquea
-- a los no-admin.
--
-- OJO: 20261015000001 reescribe product_stock_components entera y quitaría
-- este componente. Si se re-ejecuta, pegar después 20261016000002 y esta.
--
-- Aplicación manual en Supabase SQL Editor (proyecto gbuifpsgcvxmuwzoyush).
-- Solo datos: se puede aplicar antes o después de desplegar. IDEMPOTENTE.
-- =============================================================

BEGIN;

INSERT INTO public.stock_pools (key, label, article_ids, notes) VALUES
  ('kds-estandar', 'KDS Standard (UNICOPOS W2164N)',
     ARRAY['d14b93a7-7ae1-4650-a891-f89eb0bde0c1',
           '35b17837-05fb-4687-a9b4-7314fab72a6b']::uuid[],
     'UNICOPOS UNICO-W2164N. Pedro porto V022PTD02 es la misma pantalla dada de alta con otro nombre.')
ON CONFLICT (key) DO UPDATE
  SET label       = EXCLUDED.label,
      article_ids = EXCLUDED.article_ids,
      notes       = EXCLUDED.notes,
      updated_at  = NOW();

INSERT INTO public.product_stock_components (product_code, pool_key, quantity) VALUES
  ('kds-estandar', 'kds-estandar', 1)
ON CONFLICT (product_code, pool_key) DO UPDATE
  SET quantity = EXCLUDED.quantity;

COMMIT;

-- -------------------------------------------------------------
-- Comprobación. Esperado: 1 fila, kds-estandar -> pool kds-estandar ×1
-- con los 2 artículos.
-- -------------------------------------------------------------
SELECT p.code,
       p.name,
       p.active,
       p.supplier_fallback,
       c.pool_key,
       c.quantity,
       sp.article_ids
  FROM public.products p
  LEFT JOIN public.product_stock_components c ON c.product_code = p.code
  LEFT JOIN public.stock_pools sp             ON sp.key = c.pool_key
 WHERE p.code = 'kds-estandar';
