BEGIN;

DROP TRIGGER IF EXISTS trg_validate_lot_topology ON gis.lots;
DROP TRIGGER IF EXISTS trg_snap_pipe_endpoints ON utility.pipes;
DROP TRIGGER IF EXISTS trg_snap_service_connection_endpoints ON utility.service_connections;

DROP FUNCTION IF EXISTS gis.validate_lot_topology();
DROP FUNCTION IF EXISTS utility.snap_linear_asset_to_network_nodes();
DROP TABLE IF EXISTS gis.migration_quarantine;

COMMIT;
