BEGIN;

DROP INDEX IF EXISTS public.idx_gis_lots_block_id;
DROP INDEX IF EXISTS public.idx_gis_lots_district_id;
DROP INDEX IF EXISTS public.idx_gis_lots_source_global_id;

ALTER TABLE public.gis_lots
  DROP COLUMN IF EXISTS synced_at,
  DROP COLUMN IF EXISTS block_match_method,
  DROP COLUMN IF EXISTS source_updated_at,
  DROP COLUMN IF EXISTS levels,
  DROP COLUMN IF EXISTS project_status,
  DROP COLUMN IF EXISTS lot_type_code,
  DROP COLUMN IF EXISTS locality_code,
  DROP COLUMN IF EXISTS property_code,
  DROP COLUMN IF EXISTS cod_mza,
  DROP COLUMN IF EXISTS cup_code,
  DROP COLUMN IF EXISTS source_object_id,
  DROP COLUMN IF EXISTS global_id,
  DROP COLUMN IF EXISTS block_id;

DROP TABLE IF EXISTS public.gis_blocks;
DROP INDEX IF EXISTS public.idx_gis_districts_district_code;
ALTER TABLE public.gis_districts DROP COLUMN IF EXISTS district_code;

COMMIT;
