BEGIN;

CREATE TABLE IF NOT EXISTS gis.geometry_repair_audit (
  asset_kind text NOT NULL CHECK (asset_kind IN ('BLOCK', 'LOT')),
  asset_id uuid NOT NULL,
  repair_method text NOT NULL,
  original_geom geometry(MultiPolygon, 32718) NOT NULL,
  repaired_geom geometry(MultiPolygon, 32718) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_kind, asset_id)
);

CREATE INDEX IF NOT EXISTS geometry_repair_audit_original_geom_gix
  ON gis.geometry_repair_audit USING gist (original_geom);
CREATE INDEX IF NOT EXISTS geometry_repair_audit_repaired_geom_gix
  ON gis.geometry_repair_audit USING gist (repaired_geom);

CREATE TEMP TABLE repair_lot_raw ON COMMIT DROP AS
SELECT
  legacy.id,
  district.id AS district_id,
  legacy.block_id,
  legacy.lot_code,
  COALESCE(legacy.cup_code, legacy.property_code) AS cadastral_code,
  COALESCE(legacy.global_id::text, legacy.source_object_id::text) AS external_id,
  source.id AS source_id,
  legacy.source_updated_at,
  legacy.updated_at,
  ST_Transform(ST_Force2D(legacy.geom), 32718)::geometry(MultiPolygon, 32718) AS geom
FROM public.gis_lots legacy
JOIN public.gis_districts legacy_district ON legacy_district.id = legacy.district_id
JOIN gis.districts district ON district.district_code = legacy_district.district_code
JOIN gis.data_sources source
  ON source.code = 'legacy_catastro:' || md5(lower(btrim(legacy.source)));

CREATE UNIQUE INDEX repair_lot_raw_id_idx ON repair_lot_raw (id);
CREATE INDEX repair_lot_raw_geom_gix ON repair_lot_raw USING gist (geom);
CREATE INDEX repair_lot_raw_district_idx ON repair_lot_raw (district_id);
CREATE INDEX repair_lot_raw_block_idx ON repair_lot_raw (block_id);

DO $$
DECLARE invalid_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM repair_lot_raw
  WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom);
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'No se pueden reparar topologicamente % lotes con geometria base invalida', invalid_count;
  END IF;
END;
$$;

CREATE TEMP TABLE repair_conflict_pairs ON COMMIT DROP AS
SELECT
  left_lot.id AS left_id,
  right_lot.id AS right_id,
  ST_Area(ST_Intersection(left_lot.geom, right_lot.geom)) AS overlap_area_m2
FROM repair_lot_raw left_lot
JOIN repair_lot_raw right_lot
  ON right_lot.district_id = left_lot.district_id
 AND right_lot.id > left_lot.id
 AND right_lot.geom && left_lot.geom
 AND ST_Intersects(right_lot.geom, left_lot.geom)
 AND ST_Area(ST_Intersection(right_lot.geom, left_lot.geom)) > 0.000001;

CREATE INDEX repair_conflict_pairs_left_idx ON repair_conflict_pairs (left_id);
CREATE INDEX repair_conflict_pairs_right_idx ON repair_conflict_pairs (right_id);

CREATE TEMP TABLE repair_vertices ON COMMIT DROP AS
SELECT id, row_number() OVER (ORDER BY id)::bigint AS vertex_id
FROM (
  SELECT left_id AS id FROM repair_conflict_pairs
  UNION
  SELECT right_id FROM repair_conflict_pairs
) participants;

CREATE UNIQUE INDEX repair_vertices_id_idx ON repair_vertices (id);
CREATE UNIQUE INDEX repair_vertices_vertex_idx ON repair_vertices (vertex_id);

CREATE TEMP TABLE repair_edges ON COMMIT DROP AS
SELECT
  row_number() OVER (ORDER BY pair.left_id, pair.right_id)::bigint AS id,
  left_vertex.vertex_id AS source,
  right_vertex.vertex_id AS target,
  1.0::double precision AS cost,
  1.0::double precision AS reverse_cost
FROM repair_conflict_pairs pair
JOIN repair_vertices left_vertex ON left_vertex.id = pair.left_id
JOIN repair_vertices right_vertex ON right_vertex.id = pair.right_id;

CREATE TEMP TABLE repair_components ON COMMIT DROP AS
SELECT vertex.id, component.component
FROM pgr_connectedComponents(
  'SELECT id, source, target, cost, reverse_cost FROM repair_edges'
) component
JOIN repair_vertices vertex ON vertex.vertex_id = component.node;

CREATE UNIQUE INDEX repair_components_id_idx ON repair_components (id);
CREATE INDEX repair_components_component_idx ON repair_components (component);

CREATE TEMP TABLE repair_participants ON COMMIT DROP AS
SELECT
  raw.id,
  raw.geom,
  component.component,
  ST_GeometryN(
    ST_GeneratePoints(
      raw.geom,
      1,
      (mod(abs(hashtextextended(raw.id::text, 0)::numeric), 2147483646) + 1)::integer
    ),
    1
  )::geometry(Point, 32718) AS seed
FROM repair_lot_raw raw
JOIN repair_components component ON component.id = raw.id;

CREATE INDEX repair_participants_component_idx ON repair_participants (component);

CREATE TEMP TABLE repair_voronoi_cells ON COMMIT DROP AS
WITH component_geometry AS (
  SELECT
    component,
    ST_VoronoiPolygons(
      ST_Collect(seed),
      0.0,
      ST_Expand(ST_Envelope(ST_Collect(geom)), 1.0)
    ) AS cells
  FROM repair_participants
  GROUP BY component
)
SELECT component, (ST_Dump(cells)).geom::geometry(Polygon, 32718) AS geom
FROM component_geometry;

CREATE INDEX repair_voronoi_cells_geom_gix ON repair_voronoi_cells USING gist (geom);
CREATE INDEX repair_voronoi_cells_component_idx ON repair_voronoi_cells (component);

CREATE TEMP TABLE repair_lot_conflicts ON COMMIT DROP AS
SELECT
  participant.id,
  ST_Multi(ST_CollectionExtract(ST_MakeValid(
    ST_Intersection(participant.geom, cell.geom)
  ), 3))::geometry(MultiPolygon, 32718) AS geom
FROM repair_participants participant
JOIN repair_voronoi_cells cell
  ON cell.component = participant.component
 AND ST_Covers(cell.geom, participant.seed);

CREATE UNIQUE INDEX repair_lot_conflicts_id_idx ON repair_lot_conflicts (id);

DO $$
DECLARE
  participant_count bigint;
  repaired_count bigint;
  invalid_count bigint;
BEGIN
  SELECT count(*) INTO participant_count FROM repair_participants;
  SELECT count(*) INTO repaired_count FROM repair_lot_conflicts;
  SELECT count(*) INTO invalid_count
  FROM repair_lot_conflicts
  WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom) OR ST_Area(geom) <= 0.000001;

  IF repaired_count <> participant_count OR invalid_count > 0 THEN
    RAISE EXCEPTION
      'Particion topologica incompleta: % participantes, % reparados, % invalidos',
      participant_count, repaired_count, invalid_count;
  END IF;
END;
$$;

CREATE TEMP TABLE repair_lot_final ON COMMIT DROP AS
SELECT raw.*, COALESCE(repaired.geom, raw.geom)::geometry(MultiPolygon, 32718) AS repaired_geom
FROM repair_lot_raw raw
LEFT JOIN repair_lot_conflicts repaired ON repaired.id = raw.id;

CREATE UNIQUE INDEX repair_lot_final_id_idx ON repair_lot_final (id);
CREATE INDEX repair_lot_final_geom_gix ON repair_lot_final USING gist (repaired_geom);
CREATE INDEX repair_lot_final_block_idx ON repair_lot_final (block_id);

DO $$
DECLARE overlap_count bigint;
BEGIN
  SELECT count(*) INTO overlap_count
  FROM repair_lot_final left_lot
  JOIN repair_lot_final right_lot
    ON right_lot.district_id = left_lot.district_id
   AND right_lot.id > left_lot.id
   AND right_lot.repaired_geom && left_lot.repaired_geom
   AND ST_Intersects(right_lot.repaired_geom, left_lot.repaired_geom)
   AND ST_Area(ST_Intersection(right_lot.repaired_geom, left_lot.repaired_geom)) > 0.000001;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'La reparacion conserva % pares de lotes solapados', overlap_count;
  END IF;
END;
$$;

CREATE TEMP TABLE repair_block_final ON COMMIT DROP AS
WITH child_footprints AS (
  SELECT block_id, ST_UnaryUnion(ST_Collect(repaired_geom)) AS geom
  FROM repair_lot_final
  GROUP BY block_id
), transformed AS (
  SELECT
    legacy.*,
    district.id AS target_district_id,
    source.id AS target_source_id,
    ST_Transform(ST_Force2D(legacy.geom), 32718)::geometry(MultiPolygon, 32718)
      AS original_geom,
    child.geom AS child_geom
  FROM public.gis_blocks legacy
  JOIN public.gis_districts legacy_district ON legacy_district.id = legacy.district_id
  JOIN gis.districts district ON district.district_code = legacy_district.district_code
  JOIN gis.data_sources source
    ON source.code = 'legacy_catastro:' || md5(lower(btrim(legacy.source)))
  LEFT JOIN child_footprints child ON child.block_id = legacy.id
)
SELECT
  transformed.*,
  ST_Multi(ST_CollectionExtract(ST_MakeValid(
    CASE
      WHEN child_geom IS NULL THEN ST_MakeValid(original_geom)
      ELSE ST_UnaryUnion(ST_Collect(
        ST_MakeValid(original_geom),
        ST_Buffer(child_geom, 0.001, 'join=mitre')
      ))
    END
  ), 3))::geometry(MultiPolygon, 32718) AS repaired_geom
FROM transformed;

CREATE UNIQUE INDEX repair_block_final_id_idx ON repair_block_final (id);
CREATE INDEX repair_block_final_geom_gix ON repair_block_final USING gist (repaired_geom);

DO $$
DECLARE
  invalid_count bigint;
  missing_parent_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM repair_block_final
  WHERE ST_IsEmpty(repaired_geom) OR NOT ST_IsValid(repaired_geom);

  SELECT count(*) INTO missing_parent_count
  FROM repair_lot_final lot
  JOIN repair_block_final block ON block.id = lot.block_id
  WHERE NOT ST_CoveredBy(lot.repaired_geom, block.repaired_geom)
    AND ST_Area(ST_Difference(lot.repaired_geom, block.repaired_geom)) > 0.000001;

  IF invalid_count > 0 OR missing_parent_count > 0 THEN
    RAISE EXCEPTION
      'Reparacion de manzanas invalida: % geometrias invalidas, % lotes fuera del padre',
      invalid_count, missing_parent_count;
  END IF;
END;
$$;

INSERT INTO gis.geometry_repair_audit (
  asset_kind, asset_id, repair_method, original_geom, repaired_geom, details, repaired_at
)
SELECT
  'LOT', raw.id, 'VORONOI_CONFLICT_PARTITION', raw.geom, repaired.geom,
  jsonb_build_object(
    'conflictCount', count(pair.*),
    'originalAreaM2', ST_Area(raw.geom),
    'repairedAreaM2', ST_Area(repaired.geom)
  ),
  now()
FROM repair_lot_raw raw
JOIN repair_lot_conflicts repaired ON repaired.id = raw.id
LEFT JOIN repair_conflict_pairs pair ON pair.left_id = raw.id OR pair.right_id = raw.id
GROUP BY raw.id, raw.geom, repaired.geom
ON CONFLICT (asset_kind, asset_id) DO UPDATE SET
  repair_method = EXCLUDED.repair_method,
  original_geom = EXCLUDED.original_geom,
  repaired_geom = EXCLUDED.repaired_geom,
  details = EXCLUDED.details,
  repaired_at = now();

INSERT INTO gis.geometry_repair_audit (
  asset_kind, asset_id, repair_method, original_geom, repaired_geom, details, repaired_at
)
SELECT
  'BLOCK', id, 'EXPAND_TO_CHILD_LOT_FOOTPRINT', original_geom, repaired_geom,
  jsonb_build_object(
    'originalAreaM2', ST_Area(original_geom),
    'repairedAreaM2', ST_Area(repaired_geom)
  ),
  now()
FROM repair_block_final
WHERE NOT ST_Equals(ST_MakeValid(original_geom), repaired_geom)
ON CONFLICT (asset_kind, asset_id) DO UPDATE SET
  repair_method = EXCLUDED.repair_method,
  original_geom = EXCLUDED.original_geom,
  repaired_geom = EXCLUDED.repaired_geom,
  details = EXCLUDED.details,
  repaired_at = now();

DELETE FROM gis.lots;

INSERT INTO gis.blocks (
  id, district_id, block_code, external_id, source_id, geom,
  topology_status, source_updated_at, updated_at
)
SELECT
  id, target_district_id, block_code,
  COALESCE(global_id::text, source_object_id::text),
  target_source_id, repaired_geom, 'VALID', source_updated_at, updated_at
FROM repair_block_final
ON CONFLICT (id) DO UPDATE SET
  district_id = EXCLUDED.district_id,
  block_code = EXCLUDED.block_code,
  external_id = EXCLUDED.external_id,
  source_id = EXCLUDED.source_id,
  geom = EXCLUDED.geom,
  topology_status = 'VALID',
  source_updated_at = EXCLUDED.source_updated_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO gis.lots (
  id, district_id, block_id, lot_code, cadastral_code, external_id, source_id,
  geom, topology_status, source_updated_at, updated_at
)
SELECT
  id, district_id, block_id, lot_code, cadastral_code, external_id, source_id,
  repaired_geom, 'PENDING', source_updated_at, updated_at
FROM repair_lot_final
ORDER BY district_id, id;

TRUNCATE TABLE gis.migration_quarantine;

DO $$
DECLARE
  source_count bigint;
  target_count bigint;
  quarantine_count bigint;
BEGIN
  SELECT count(*) INTO source_count FROM public.gis_lots;
  SELECT count(*) INTO target_count FROM gis.lots;
  SELECT count(*) INTO quarantine_count FROM gis.migration_quarantine;
  IF source_count <> target_count OR quarantine_count <> 0 THEN
    RAISE EXCEPTION
      'Postflight incompleto: % lotes origen, % lotes operativos, % en cuarentena',
      source_count, target_count, quarantine_count;
  END IF;
END;
$$;

ANALYZE gis.blocks;
ANALYZE gis.lots;
ANALYZE gis.geometry_repair_audit;

COMMIT;
