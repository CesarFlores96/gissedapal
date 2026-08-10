BEGIN;

DROP VIEW IF EXISTS public.gis_supply_cadastral_hierarchy;
DROP TABLE IF EXISTS public.customer_supply_catastro_extensions;
DROP TABLE IF EXISTS public.gis_supply_lot_links;
DROP TABLE IF EXISTS public.gis_cadastral_lot_geometries;
DROP TABLE IF EXISTS public.gis_cadastral_lot_units;
DROP TABLE IF EXISTS public.gis_cadastral_blocks;

COMMIT;
