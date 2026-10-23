-- =============================================================
-- Recogidas TIPSA (pickups) + su historial (pickup_events)
-- Migration: 20261023000001_pickups
-- Tipo: aditiva. Dos tablas nuevas, no toca nada existente.
-- =============================================================
--
-- Una recogida es TIPSA yendo a buscar material a casa de un cliente para
-- traerlo a nuestro almacen o al SAT de un proveedor. Hoy se pide a la
-- comercial de TIPSA; con esto se da de alta desde MainOps (GrabaRecogida).
--
-- Nacen de dos sitios:
--   * HSM: un RMA pide la recogida via /api/external/hsm/pickups
--     (contrato en docs/integrations/hsm/RECOGIDAS-CONTRATO.md).
--   * MainOps: alta manual desde /recogidas.
--
-- Tabla propia de eventos en vez de shipping_events: esa tabla tiene un CHECK
-- XOR order_id/shipment_id que alimenta todo el tracking de envios, y meter
-- un tercer destino ahi es tocar el nucleo para nada.

-- -----------------------------------------------------------------
-- 1. Sequence + generate_pickup_id (paralela a generate_shipment_id)
-- -----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS pickup_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_pickup_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  prefix TEXT;
  seq_val BIGINT;
BEGIN
  prefix := 'RC-' || TO_CHAR(NOW(), 'YYYYMM') || '-';
  seq_val := NEXTVAL('pickup_seq');
  RETURN prefix || LPAD(seq_val::TEXT, 4, '0');
END;
$$;

-- -----------------------------------------------------------------
-- 2. Tabla pickups
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pickups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id                TEXT UNIQUE NOT NULL DEFAULT public.generate_pickup_id(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES public.user_profiles(id),

  -- Origen de la peticion
  source                   TEXT NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('hsm', 'manual')),
  source_id                TEXT,          -- id del RMA en HSM
  source_ref               TEXT,          -- RMA-YYYY-NNNNN
  requested_by_name        TEXT,
  requested_by_email       TEXT,
  reason                   TEXT NOT NULL DEFAULT 'rma'
                             CHECK (reason IN ('rma', 'devolucion', 'baja', 'cambio', 'otro')),

  status                   TEXT NOT NULL DEFAULT 'solicitada'
                             CHECK (status IN ('solicitada', 'programada', 'incidencia',
                                               'en_curso', 'recibida', 'anulada')),

  -- Donde se recoge (el cliente)
  origin_name              TEXT NOT NULL,
  origin_contact           TEXT,
  origin_phone             TEXT NOT NULL,
  origin_email             TEXT,
  origin_address           TEXT NOT NULL,
  origin_cp                TEXT NOT NULL CHECK (origin_cp ~ '^\d{5}$'),
  origin_city              TEXT NOT NULL,
  origin_province          TEXT,

  -- A donde va: nuestro almacen (TIPSA_SENDER_*) o el SAT del proveedor
  destination_type         TEXT NOT NULL DEFAULT 'oficina'
                             CHECK (destination_type IN ('oficina', 'sat')),
  destination_name         TEXT,
  destination_contact      TEXT,
  destination_phone        TEXT,
  destination_address      TEXT,
  destination_cp           TEXT CHECK (destination_cp IS NULL OR destination_cp ~ '^\d{5}$'),
  destination_city         TEXT,

  -- Que se recoge
  items                    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{description, serial}]
  instructions             TEXT,
  packages                 INT  NOT NULL DEFAULT 1 CHECK (packages >= 1),
  weight_kg                NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (weight_kg > 0),

  -- Cuando (se rellena al programar)
  pickup_date              DATE,
  time_from                TIME,
  time_to                  TIME,
  service_code             TEXT,

  -- TIPSA
  tipsa_code               TEXT,          -- strCodOut de GrabaRecogida
  tipsa_guid               TEXT,
  tipsa_origin_agency      TEXT,
  tipsa_reserved_albaran   TEXT,          -- strCodEnvioReservadoOut
  albaran                  TEXT,          -- V_COD_ENV: el envio que genera al recoger
  tracking_last_status     TEXT,          -- ultimo codigo de la recogida o del envio
  tracking_last_checked_at TIMESTAMPTZ,
  incidence_code           TEXT,          -- AS, NTM, EI... (ConsRecIncidencias)
  incidence_label          TEXT,
  incidence_obs            TEXT,

  scheduled_at             TIMESTAMPTZ,
  picked_up_at             TIMESTAMPTZ,
  received_at              TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_reason            TEXT,

  -- Ultimo estado que HSM ha confirmado (2xx del webhook). Si difiere de
  -- status, el cron lo reenvia.
  hsm_notified_status      TEXT,
  hsm_notified_at          TIMESTAMPTZ,

  notes                    TEXT,

  CONSTRAINT pickups_sat_needs_address CHECK (
    destination_type <> 'sat'
    OR (destination_name IS NOT NULL AND destination_address IS NOT NULL
        AND destination_cp IS NOT NULL AND destination_city IS NOT NULL)
  ),
  CONSTRAINT pickups_hsm_needs_source CHECK (
    source <> 'hsm' OR (source_id IS NOT NULL AND source_ref IS NOT NULL)
  )
);

COMMENT ON TABLE  public.pickups IS 'Recogidas TIPSA: de un cliente a nuestro almacen o al SAT del proveedor.';
COMMENT ON COLUMN public.pickups.pickup_id IS 'Formato RC-YYYYMM-NNNN. Generado automaticamente.';
COMMENT ON COLUMN public.pickups.status IS
  'solicitada (sin enviar a TIPSA) > programada > incidencia | en_curso (TIPSA genero el envio) > recibida. anulada en cualquier momento.';

DROP TRIGGER IF EXISTS pickups_updated_at ON public.pickups;
CREATE TRIGGER pickups_updated_at
  BEFORE UPDATE ON public.pickups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_pickups_created_at ON public.pickups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickups_status     ON public.pickups (status);
CREATE INDEX IF NOT EXISTS idx_pickups_source     ON public.pickups (source, source_id);

-- Un RMA no puede tener dos recogidas activas: un doble clic en HSM devuelve
-- la existente en vez de duplicar. Anulada, se puede pedir otra.
CREATE UNIQUE INDEX IF NOT EXISTS pickups_one_active_per_source
  ON public.pickups (source, source_id)
  WHERE source_id IS NOT NULL AND status <> 'anulada';

-- -----------------------------------------------------------------
-- 3. Historial de la recogida
-- -----------------------------------------------------------------
-- kind:
--   recogida  estados de la recogida en TIPSA (ConsRecEstados)
--   envio     estados del envio que TIPSA genera al recoger (ConsEnvEstados)
--   app       acciones nuestras: solicitada, programada, anulada... (event_code = accion)
CREATE TABLE IF NOT EXISTS public.pickup_events (
  id           BIGSERIAL PRIMARY KEY,
  pickup_id    UUID NOT NULL REFERENCES public.pickups(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('recogida', 'envio', 'app')),
  event_code   TEXT NOT NULL,
  event_label  TEXT,
  event_date   TIMESTAMPTZ NOT NULL,
  created_by   UUID REFERENCES public.user_profiles(id),
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_events_pickup ON public.pickup_events (pickup_id, event_date);

-- Dedupe de los eventos de TIPSA: el refresco los pide enteros cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS pickup_events_unique_tipsa
  ON public.pickup_events (pickup_id, kind, event_code, event_date)
  WHERE kind IN ('recogida', 'envio');

-- -----------------------------------------------------------------
-- 4. RLS (mismo reparto que shipments)
-- -----------------------------------------------------------------
ALTER TABLE public.pickups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pickups: hardware full" ON public.pickups;
CREATE POLICY "pickups: hardware full"
  ON public.pickups FOR ALL
  USING (public.get_my_role() = 'hardware');

DROP POLICY IF EXISTS "pickups: admin full" ON public.pickups;
CREATE POLICY "pickups: admin full"
  ON public.pickups FOR ALL
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "pickups: others read" ON public.pickups;
CREATE POLICY "pickups: others read"
  ON public.pickups FOR SELECT
  USING (public.get_my_role() IN ('manager', 'commercial', 'viewer'));

DROP POLICY IF EXISTS "pickup_events: read" ON public.pickup_events;
CREATE POLICY "pickup_events: read"
  ON public.pickup_events FOR SELECT
  USING (public.get_my_role() IN ('hardware', 'admin', 'manager', 'commercial', 'viewer'));

DROP POLICY IF EXISTS "pickup_events: write" ON public.pickup_events;
CREATE POLICY "pickup_events: write"
  ON public.pickup_events FOR INSERT
  WITH CHECK (public.get_my_role() IN ('hardware', 'admin'));

-- -----------------------------------------------------------------
-- 5. Verificacion: deben salir 2 filas (pickups, pickup_events) con rls = true
-- -----------------------------------------------------------------
SELECT c.relname AS tabla, c.relrowsecurity AS rls,
       (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('pickups', 'pickup_events')
ORDER BY c.relname;

-- ROLLBACK manual:
--   DROP TABLE    IF EXISTS public.pickup_events;
--   DROP TABLE    IF EXISTS public.pickups;
--   DROP FUNCTION IF EXISTS public.generate_pickup_id();
--   DROP SEQUENCE IF EXISTS pickup_seq;
