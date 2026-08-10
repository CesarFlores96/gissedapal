BEGIN;

DROP FUNCTION IF EXISTS mvt.supplies(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.valves(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.water_connections(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.water_pipes(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.lots(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.blocks(integer, integer, integer);
DROP FUNCTION IF EXISTS mvt.districts(integer, integer, integer);

DROP SCHEMA IF EXISTS mvt;

COMMIT;
