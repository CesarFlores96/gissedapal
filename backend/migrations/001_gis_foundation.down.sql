BEGIN;

DROP INDEX IF EXISTS public.idx_meter_registry_nis_latest;
DROP TABLE IF EXISTS public.gis_supply_locations;
DROP TABLE IF EXISTS public.gis_lots;
DROP TABLE IF EXISTS public.gis_quadrants;
DROP TABLE IF EXISTS public.gis_districts;

COMMIT;
