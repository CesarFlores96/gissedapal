BEGIN;

-- Geometría y procedencia para las líneas descargadas desde ArcGIS.
ALTER TABLE public.network_pipes
  ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326),
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_asset_code text,
  ADD COLUMN IF NOT EXISTS source_globalid text,
  ADD COLUMN IF NOT EXISTS source_layer_id integer,
  ADD COLUMN IF NOT EXISTS source_district_code text,
  ADD COLUMN IF NOT EXISTS source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_network_pipes_geom ON public.network_pipes USING gist (geom);
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_pipes_xls_source
  ON public.network_pipes (source_system, source_globalid)
  WHERE source_system IS NOT NULL AND source_globalid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.network_service_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL UNIQUE,
  diameter_mm numeric(10,2),
  material text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'OUT_OF_SERVICE')),
  source_system text NOT NULL,
  source_globalid text NOT NULL,
  source_layer_id integer NOT NULL,
  source_district_code text,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(LineString, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_globalid),
  CHECK (ST_IsValid(geom)),
  CHECK (ST_NPoints(geom) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_network_service_connections_geom
  ON public.network_service_connections USING gist (geom);

COMMIT;
