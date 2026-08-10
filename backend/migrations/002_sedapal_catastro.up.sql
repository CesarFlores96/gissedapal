BEGIN;

ALTER TABLE public.gis_districts
  ADD COLUMN IF NOT EXISTS district_code text;

UPDATE public.gis_districts
SET district_code = '010', updated_at = now()
WHERE upper(name) = 'EL AGUSTINO'
  AND district_code IS DISTINCT FROM '010';

CREATE UNIQUE INDEX IF NOT EXISTS idx_gis_districts_district_code
  ON public.gis_districts (district_code)
  WHERE district_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gis_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id bigint NOT NULL REFERENCES public.gis_districts(id) ON DELETE CASCADE,
  block_code text NOT NULL,
  global_id uuid NOT NULL,
  source_object_id bigint NOT NULL,
  property_code text,
  block_type_code text,
  source text NOT NULL,
  source_updated_at timestamptz,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, global_id),
  UNIQUE (source, district_id, block_code)
);

ALTER TABLE public.gis_lots
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES public.gis_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS global_id uuid,
  ADD COLUMN IF NOT EXISTS source_object_id bigint,
  ADD COLUMN IF NOT EXISTS cup_code text,
  ADD COLUMN IF NOT EXISTS cod_mza text,
  ADD COLUMN IF NOT EXISTS property_code text,
  ADD COLUMN IF NOT EXISTS locality_code text,
  ADD COLUMN IF NOT EXISTS lot_type_code text,
  ADD COLUMN IF NOT EXISTS project_status text,
  ADD COLUMN IF NOT EXISTS levels integer,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS block_match_method text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_gis_lots_source_global_id
  ON public.gis_lots (source, global_id)
  WHERE global_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_blocks_district_id ON public.gis_blocks (district_id);
CREATE INDEX IF NOT EXISTS idx_gis_blocks_geom ON public.gis_blocks USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_gis_lots_district_id ON public.gis_lots (district_id);
CREATE INDEX IF NOT EXISTS idx_gis_lots_block_id ON public.gis_lots (block_id);

COMMIT;
