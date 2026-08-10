BEGIN;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mvt FROM sedapalgis_martin;
REVOKE USAGE ON SCHEMA mvt FROM sedapalgis_martin;
REVOKE ALL ON
  gis.lots,
  gis.legal_entities,
  gis.lot_legal_entities,
  utility.supplies,
  utility.service_connections,
  utility.meters
FROM sedapal;
REVOKE USAGE ON SCHEMA gis, utility FROM sedapal;

COMMIT;
