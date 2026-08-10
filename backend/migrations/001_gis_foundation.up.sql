BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.gis_districts (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  province text,
  department text,
  source text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, province, department)
);

CREATE TABLE IF NOT EXISTS public.gis_quadrants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id bigint REFERENCES public.gis_districts(id) ON DELETE SET NULL,
  code text NOT NULL UNIQUE,
  name text,
  source text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gis_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id bigint REFERENCES public.gis_districts(id) ON DELETE SET NULL,
  quadrant_id uuid REFERENCES public.gis_quadrants(id) ON DELETE SET NULL,
  lot_code text NOT NULL,
  source text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, lot_code)
);

CREATE TABLE IF NOT EXISTS public.gis_supply_locations (
  supply_id uuid PRIMARY KEY,
  supply_code text NOT NULL UNIQUE,
  geom geometry(Point, 4326) NOT NULL,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gis_supply_locations (supply_id, supply_code, geom, source_updated_at, synced_at)
SELECT id, supply_code, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), updated_at, now()
FROM public.customer_supplies
WHERE longitude BETWEEN -180 AND 180 AND latitude BETWEEN -90 AND 90
ON CONFLICT (supply_id) DO UPDATE SET
  supply_code = EXCLUDED.supply_code,
  geom = EXCLUDED.geom,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

CREATE INDEX IF NOT EXISTS idx_gis_districts_geom ON public.gis_districts USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_gis_quadrants_geom ON public.gis_quadrants USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_gis_lots_geom ON public.gis_lots USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_gis_supply_locations_geom ON public.gis_supply_locations USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_meter_registry_nis_latest
  ON public.meter_registry (nis_rad, registry_status, anio_fabric DESC)
  WHERE nis_rad IS NOT NULL;

COMMIT;
