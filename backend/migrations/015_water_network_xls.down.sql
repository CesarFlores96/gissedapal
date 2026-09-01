BEGIN;
DROP TABLE IF EXISTS public.network_service_connections;
DROP INDEX IF EXISTS uq_network_pipes_xls_source;
DROP INDEX IF EXISTS idx_network_pipes_geom;
ALTER TABLE public.network_pipes
  DROP COLUMN IF EXISTS source_attributes,
  DROP COLUMN IF EXISTS source_district_code,
  DROP COLUMN IF EXISTS source_layer_id,
  DROP COLUMN IF EXISTS source_globalid,
  DROP COLUMN IF EXISTS source_asset_code,
  DROP COLUMN IF EXISTS source_system,
  DROP COLUMN IF EXISTS geom;
COMMIT;
