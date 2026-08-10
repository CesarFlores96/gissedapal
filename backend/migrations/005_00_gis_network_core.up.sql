BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS gis;
CREATE SCHEMA IF NOT EXISTS utility;
CREATE SCHEMA IF NOT EXISTS roads;

CREATE TABLE gis.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  authority_name text,
  imported_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE gis.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  document_number text NOT NULL,
  legal_name text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN
    ('PERSONA_NATURAL', 'PERSONA_JURIDICA', 'ENTIDAD_PUBLICA')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, document_number)
);

CREATE TABLE gis.districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_code text NOT NULL UNIQUE,
  name text NOT NULL,
  province text NOT NULL,
  department text NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  geom geometry(MultiPolygon, 32718) NOT NULL,
  topology_status text NOT NULL DEFAULT 'PENDING'
    CHECK (topology_status IN ('PENDING', 'VALID', 'INVALID')),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom)),
  CHECK (NOT ST_IsEmpty(geom))
);

CREATE TABLE gis.blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES gis.districts(id) ON DELETE RESTRICT,
  block_code text NOT NULL,
  external_id text,
  source_id uuid REFERENCES gis.data_sources(id),
  geom geometry(MultiPolygon, 32718) NOT NULL,
  topology_status text NOT NULL DEFAULT 'PENDING'
    CHECK (topology_status IN ('PENDING', 'VALID', 'INVALID')),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, block_code),
  UNIQUE NULLS NOT DISTINCT (source_id, external_id),
  CHECK (ST_IsValid(geom)),
  CHECK (NOT ST_IsEmpty(geom))
);

CREATE TABLE gis.lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES gis.districts(id) ON DELETE RESTRICT,
  block_id uuid NOT NULL REFERENCES gis.blocks(id) ON DELETE RESTRICT,
  lot_code text NOT NULL,
  cadastral_code text,
  external_id text,
  source_id uuid REFERENCES gis.data_sources(id),
  geom geometry(MultiPolygon, 32718) NOT NULL,
  topology_status text NOT NULL DEFAULT 'PENDING'
    CHECK (topology_status IN ('PENDING', 'VALID', 'INVALID')),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, lot_code),
  UNIQUE NULLS NOT DISTINCT (source_id, external_id),
  CHECK (ST_IsValid(geom)),
  CHECK (NOT ST_IsEmpty(geom))
);

CREATE TABLE gis.lot_legal_entities (
  lot_id uuid NOT NULL REFERENCES gis.lots(id) ON DELETE RESTRICT,
  legal_entity_id uuid NOT NULL REFERENCES gis.legal_entities(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL CHECK (relationship_type IN
    ('OWNER', 'TENANT', 'ADMINISTRATOR', 'BENEFICIARY', 'OTHER')),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  evidence_reference text,
  PRIMARY KEY (lot_id, legal_entity_id, relationship_type, valid_from),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE utility.network_nodes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_code text NOT NULL UNIQUE,
  node_type text NOT NULL CHECK (node_type IN
    ('JUNCTION', 'RESERVOIR', 'TANK', 'SOURCE', 'PUMP', 'VALVE', 'METER', 'TERMINAL')),
  elevation_m numeric(10,3),
  is_active boolean NOT NULL DEFAULT true,
  geom geometry(Point, 32718) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE utility.pipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL UNIQUE,
  pipe_class text NOT NULL CHECK (pipe_class IN ('MATRIX', 'DISTRIBUTION')),
  material text,
  diameter_mm numeric(10,2) CHECK (diameter_mm > 0),
  installation_year smallint CHECK (installation_year BETWEEN 1800 AND 2200),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'OUT_OF_SERVICE', 'ABANDONED', 'PLANNED')),
  from_node_id bigint NOT NULL REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  to_node_id bigint NOT NULL REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  is_bidirectional boolean NOT NULL DEFAULT true,
  hydraulic_cost numeric(14,4) NOT NULL DEFAULT 1 CHECK (hydraulic_cost > 0),
  geom geometry(LineString, 32718) NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  CHECK (ST_IsValid(geom)),
  CHECK (ST_NPoints(geom) >= 2)
);

CREATE TABLE utility.service_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL UNIQUE,
  pipe_id uuid NOT NULL REFERENCES utility.pipes(id) ON DELETE RESTRICT,
  from_node_id bigint NOT NULL REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  to_node_id bigint NOT NULL REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  diameter_mm numeric(10,2) CHECK (diameter_mm > 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISCONNECTED', 'PLANNED')),
  geom geometry(LineString, 32718) NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE utility.valves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL UNIQUE,
  node_id bigint NOT NULL UNIQUE REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  valve_type text NOT NULL,
  normal_position text NOT NULL DEFAULT 'OPEN' CHECK (normal_position IN ('OPEN', 'CLOSED')),
  current_position text NOT NULL DEFAULT 'OPEN' CHECK (current_position IN ('OPEN', 'CLOSED', 'UNKNOWN')),
  operable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OUT_OF_SERVICE', 'ABANDONED')),
  geom geometry(Point, 32718) NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE utility.supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_code text NOT NULL UNIQUE,
  legal_entity_id uuid REFERENCES gis.legal_entities(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES gis.lots(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES utility.service_connections(id) ON DELETE SET NULL,
  node_id bigint NOT NULL UNIQUE REFERENCES utility.network_nodes(id) ON DELETE RESTRICT,
  service_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (service_status IN ('ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'PENDING')),
  geom geometry(Point, 32718) NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE utility.meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text NOT NULL UNIQUE,
  supply_id uuid NOT NULL REFERENCES utility.supplies(id) ON DELETE RESTRICT,
  meter_type text,
  diameter_mm numeric(10,2) CHECK (diameter_mm > 0),
  installation_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED', 'FAULTY', 'PENDING')),
  geom geometry(Point, 32718) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE roads.nodes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_code text NOT NULL UNIQUE,
  elevation_m numeric(10,3),
  is_active boolean NOT NULL DEFAULT true,
  geom geometry(Point, 32718) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(geom))
);

CREATE TABLE roads.edges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  edge_code text NOT NULL UNIQUE,
  road_name text,
  road_type text NOT NULL CHECK (road_type IN ('AVENIDA', 'CALLE', 'JIRON', 'CARRETERA', 'PASAJE', 'OTRO')),
  source_node_id bigint NOT NULL REFERENCES roads.nodes(id) ON DELETE RESTRICT,
  target_node_id bigint NOT NULL REFERENCES roads.nodes(id) ON DELETE RESTRICT,
  direction text NOT NULL DEFAULT 'BOTH' CHECK (direction IN ('BOTH', 'FORWARD', 'REVERSE')),
  speed_kmh numeric(6,2) CHECK (speed_kmh > 0),
  length_m numeric(14,3) NOT NULL CHECK (length_m > 0),
  cost numeric(14,4) NOT NULL CHECK (cost > 0),
  reverse_cost numeric(14,4) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'PLANNED')),
  geom geometry(LineString, 32718) NOT NULL,
  source_id uuid REFERENCES gis.data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_node_id <> target_node_id),
  CHECK (ST_IsValid(geom))
);

CREATE INDEX districts_geom_gix ON gis.districts USING gist (geom);
CREATE INDEX blocks_geom_gix ON gis.blocks USING gist (geom);
CREATE INDEX lots_geom_gix ON gis.lots USING gist (geom);
CREATE INDEX lots_district_idx ON gis.lots (district_id);
CREATE INDEX lots_block_idx ON gis.lots (block_id);
CREATE INDEX utility_nodes_geom_gix ON utility.network_nodes USING gist (geom);
CREATE INDEX utility_pipes_geom_gix ON utility.pipes USING gist (geom);
CREATE INDEX utility_pipes_from_node_idx ON utility.pipes (from_node_id);
CREATE INDEX utility_pipes_to_node_idx ON utility.pipes (to_node_id);
CREATE INDEX utility_connections_geom_gix ON utility.service_connections USING gist (geom);
CREATE INDEX utility_valves_geom_gix ON utility.valves USING gist (geom);
CREATE INDEX utility_supplies_geom_gix ON utility.supplies USING gist (geom);
CREATE INDEX utility_supplies_lot_idx ON utility.supplies (lot_id);
CREATE INDEX utility_supplies_connection_idx ON utility.supplies (connection_id);
CREATE INDEX utility_meters_geom_gix ON utility.meters USING gist (geom);
CREATE INDEX roads_nodes_geom_gix ON roads.nodes USING gist (geom);
CREATE INDEX roads_edges_geom_gix ON roads.edges USING gist (geom);
CREATE INDEX roads_edges_source_idx ON roads.edges (source_node_id);
CREATE INDEX roads_edges_target_idx ON roads.edges (target_node_id);

COMMIT;
