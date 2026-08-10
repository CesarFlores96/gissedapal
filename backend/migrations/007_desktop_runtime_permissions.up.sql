BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sedapal') THEN
    RAISE EXCEPTION 'Falta crear el rol LOGIN sedapal antes de aplicar permisos desktop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sedapalgis_martin') THEN
    RAISE EXCEPTION 'Falta crear el rol LOGIN sedapalgis_martin antes de aplicar permisos desktop';
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE bd_facturacion_local TO sedapal, sedapalgis_martin;

GRANT USAGE ON SCHEMA gis, utility TO sedapal;
GRANT SELECT ON
  gis.lots,
  gis.legal_entities,
  gis.lot_legal_entities,
  utility.supplies,
  utility.service_connections,
  utility.meters
TO sedapal;
GRANT INSERT, UPDATE, DELETE ON
  gis.legal_entities,
  gis.lot_legal_entities
TO sedapal;

GRANT USAGE ON SCHEMA mvt TO sedapalgis_martin;

ALTER FUNCTION mvt.districts(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.blocks(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.lots(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.water_pipes(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.water_connections(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.valves(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION mvt.supplies(integer, integer, integer)
  SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mvt FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mvt TO sedapalgis_martin;

COMMIT;
