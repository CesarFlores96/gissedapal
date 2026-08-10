BEGIN;

-- Prerequisito: ejecutar primero la migracion de Fase 1 que crea los esquemas
-- gis y utility y sus tablas. Esta migracion no repara ni simplifica geometria:
-- si encuentra datos incompatibles, aborta la transaccion completa.
DO $$
BEGIN
  IF to_regclass('gis.districts') IS NULL
     OR to_regclass('gis.blocks') IS NULL
     OR to_regclass('gis.lots') IS NULL
     OR to_regclass('utility.network_nodes') IS NULL
     OR to_regclass('utility.pipes') IS NULL
     OR to_regclass('utility.service_connections') IS NULL THEN
    RAISE EXCEPTION 'Falta el esquema de Fase 1 (gis/utility); la migracion no puede continuar';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION gis.validate_lot_topology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_block_geom geometry(MultiPolygon, 32718);
  conflicting_lot_id uuid;
  topology_tolerance_m constant double precision := 0.001; -- 1 milimetro
  tolerated_area_m2 constant double precision := 0.000001; -- tolerancia^2
BEGIN
  IF NOT ST_IsValid(NEW.geom) OR ST_IsEmpty(NEW.geom) THEN
    RAISE EXCEPTION 'Lote % tiene una geometria invalida o vacia', NEW.id;
  END IF;

  -- Serializa escrituras de lotes de un distrito y evita carreras entre
  -- dos INSERT simultaneos que individualmente no verian al otro lote.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.district_id::text, 0));

  SELECT b.geom
    INTO parent_block_geom
  FROM gis.blocks b
  WHERE b.id = NEW.block_id
    AND b.district_id = NEW.district_id
  FOR KEY SHARE;

  IF parent_block_geom IS NULL THEN
    RAISE EXCEPTION 'El bloque % no existe o no pertenece al distrito %',
      NEW.block_id, NEW.district_id;
  END IF;

  -- Se permite solamente una diferencia de area submilimetrica causada por
  -- aritmetica de punto flotante; no se altera la geometria entregada.
  IF NOT ST_CoveredBy(NEW.geom, parent_block_geom)
     AND ST_Area(ST_Difference(NEW.geom, parent_block_geom)) > tolerated_area_m2 THEN
    RAISE EXCEPTION 'Lote % no esta contenido en su bloque padre %', NEW.id, NEW.block_id;
  END IF;

  SELECT l.id
    INTO conflicting_lot_id
  FROM gis.lots l
  WHERE l.district_id = NEW.district_id
    AND l.id <> NEW.id
    AND l.geom && NEW.geom
    AND ST_Intersects(l.geom, NEW.geom)
    AND ST_Area(ST_Intersection(l.geom, NEW.geom)) > tolerated_area_m2
  LIMIT 1;

  IF conflicting_lot_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lote % se solapa con el lote % por encima de la tolerancia de % m2',
      NEW.id, conflicting_lot_id, tolerated_area_m2;
  END IF;

  NEW.topology_status := 'VALID';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lot_topology ON gis.lots;
CREATE TRIGGER trg_validate_lot_topology
BEFORE INSERT OR UPDATE OF geom, district_id, block_id ON gis.lots
FOR EACH ROW
EXECUTE FUNCTION gis.validate_lot_topology();

CREATE OR REPLACE FUNCTION utility.snap_linear_asset_to_network_nodes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  from_node_geom geometry(Point, 32718);
  to_node_geom geometry(Point, 32718);
  snapped_geom geometry(LineString, 32718);
BEGIN
  IF NEW.geom IS NULL OR ST_NPoints(NEW.geom) < 2 THEN
    RAISE EXCEPTION '% % debe tener como minimo dos vertices', TG_TABLE_NAME, NEW.asset_code;
  END IF;

  SELECT geom INTO from_node_geom
  FROM utility.network_nodes
  WHERE id = NEW.from_node_id
  FOR KEY SHARE;

  SELECT geom INTO to_node_geom
  FROM utility.network_nodes
  WHERE id = NEW.to_node_id
  FOR KEY SHARE;

  IF from_node_geom IS NULL OR to_node_geom IS NULL THEN
    RAISE EXCEPTION '% % referencia nodos inexistentes', TG_TABLE_NAME, NEW.asset_code;
  END IF;

  snapped_geom := ST_SetPoint(
    ST_SetPoint(NEW.geom, 0, from_node_geom),
    ST_NPoints(NEW.geom) - 1,
    to_node_geom
  );

  IF NOT ST_IsValid(snapped_geom) OR ST_IsEmpty(snapped_geom) OR ST_Length(snapped_geom) = 0 THEN
    RAISE EXCEPTION '% % queda invalida despues del snapping de extremos', TG_TABLE_NAME, NEW.asset_code;
  END IF;

  NEW.geom := snapped_geom;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snap_pipe_endpoints ON utility.pipes;
CREATE TRIGGER trg_snap_pipe_endpoints
BEFORE INSERT OR UPDATE OF geom, from_node_id, to_node_id ON utility.pipes
FOR EACH ROW
EXECUTE FUNCTION utility.snap_linear_asset_to_network_nodes();

DROP TRIGGER IF EXISTS trg_snap_service_connection_endpoints ON utility.service_connections;
CREATE TRIGGER trg_snap_service_connection_endpoints
BEFORE INSERT OR UPDATE OF geom, from_node_id, to_node_id ON utility.service_connections
FOR EACH ROW
EXECUTE FUNCTION utility.snap_linear_asset_to_network_nodes();

-- La fuente legacy contiene registros que no cumplen las reglas nuevas. Se
-- conservan sin alteracion en una cuarentena auditable; nunca se reparan ni se
-- simplifican silenciosamente para forzar su ingreso al modelo operativo.
CREATE TABLE IF NOT EXISTS gis.migration_quarantine (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL,
  source_id text NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  legacy_geom geometry(Geometry, 4326),
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, reason_code)
);

CREATE INDEX IF NOT EXISTS migration_quarantine_geom_gix
  ON gis.migration_quarantine USING gist (legacy_geom);
CREATE INDEX IF NOT EXISTS migration_quarantine_reason_idx
  ON gis.migration_quarantine (source_table, reason_code);

-- Los distritos son la raiz del arbol catastral. Una raiz invalida no puede
-- migrarse ni recibir descendientes, por lo que se exige que todas sean sanas.
DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM public.gis_districts
  WHERE district_code IS NULL
     OR ST_IsEmpty(geom)
     OR NOT ST_IsValid(geom)
     OR ST_IsEmpty(ST_Transform(ST_Force2D(geom), 32718))
     OR NOT ST_IsValid(ST_Transform(ST_Force2D(geom), 32718));
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Hay % distritos legacy incompatibles; se requiere corregir la raiz catastral', invalid_count;
  END IF;
END;
$$;

-- Mantiene el UUID de manzanas y lotes; los distritos legacy son bigint y se
-- mapean a UUID estables dentro de esta transaccion.
CREATE TEMP TABLE legacy_district_map (
  legacy_district_id bigint PRIMARY KEY,
  target_district_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO legacy_district_map (legacy_district_id, target_district_id)
SELECT legacy.id, COALESCE(target.id, gen_random_uuid())
FROM public.gis_districts legacy
LEFT JOIN gis.districts target ON target.district_code = legacy.district_code;

INSERT INTO gis.data_sources (code, name)
SELECT DISTINCT
  'legacy_catastro:' || md5(lower(btrim(source))),
  btrim(source)
FROM (
  SELECT source FROM public.gis_districts
  UNION
  SELECT source FROM public.gis_blocks
  UNION
  SELECT source FROM public.gis_lots
) sources
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO gis.districts (
  id, district_code, name, province, department, source_id, geom,
  topology_status, source_updated_at, updated_at
)
SELECT
  map.target_district_id,
  legacy.district_code,
  legacy.name,
  COALESCE(legacy.province, 'LIMA'),
  COALESCE(legacy.department, 'LIMA'),
  source.id,
  ST_Transform(ST_Force2D(legacy.geom), 32718),
  'PENDING',
  legacy.updated_at,
  legacy.updated_at
FROM public.gis_districts legacy
JOIN legacy_district_map map ON map.legacy_district_id = legacy.id
JOIN gis.data_sources source
  ON source.code = 'legacy_catastro:' || md5(lower(btrim(legacy.source)))
ON CONFLICT (district_code) DO UPDATE SET
  name = EXCLUDED.name,
  province = EXCLUDED.province,
  department = EXCLUDED.department,
  source_id = EXCLUDED.source_id,
  geom = EXCLUDED.geom,
  topology_status = 'PENDING',
  source_updated_at = EXCLUDED.source_updated_at,
  updated_at = EXCLUDED.updated_at;

CREATE TEMP TABLE staged_blocks ON COMMIT DROP AS
SELECT
  legacy.*,
  ST_Transform(ST_Force2D(legacy.geom), 32718)::geometry(MultiPolygon, 32718)
    AS target_geom,
  (district.id IS NOT NULL
    AND NOT ST_IsEmpty(legacy.geom)
    AND ST_IsValid(legacy.geom)
    AND NOT ST_IsEmpty(ST_Transform(ST_Force2D(legacy.geom), 32718))
    AND ST_IsValid(ST_Transform(ST_Force2D(legacy.geom), 32718))) AS is_eligible
FROM public.gis_blocks legacy
LEFT JOIN public.gis_districts district ON district.id = legacy.district_id;

CREATE INDEX staged_blocks_geom_gix ON staged_blocks USING gist (target_geom);
CREATE INDEX staged_blocks_district_idx ON staged_blocks (district_id);

INSERT INTO gis.migration_quarantine (
  source_table, source_id, reason_code, reason_detail, legacy_geom
)
SELECT
  'public.gis_blocks',
  id::text,
  CASE
    WHEN NOT ST_IsValid(geom) OR ST_IsEmpty(geom) THEN 'INVALID_SOURCE_GEOMETRY'
    WHEN district_id NOT IN (SELECT id FROM public.gis_districts) THEN 'ORPHAN_DISTRICT'
    ELSE 'INVALID_TRANSFORMED_GEOMETRY'
  END,
  'La manzana no cumple las restricciones geometricas del esquema operativo',
  geom
FROM staged_blocks
WHERE NOT is_eligible
ON CONFLICT (source_table, source_id, reason_code) DO UPDATE SET
  reason_detail = EXCLUDED.reason_detail,
  legacy_geom = EXCLUDED.legacy_geom,
  quarantined_at = now();

INSERT INTO gis.blocks (
  id, district_id, block_code, external_id, source_id, geom,
  topology_status, source_updated_at, updated_at
)
SELECT
  legacy.id,
  map.target_district_id,
  legacy.block_code,
  COALESCE(legacy.global_id::text, legacy.source_object_id::text),
  source.id,
  legacy.target_geom,
  'PENDING',
  legacy.source_updated_at,
  legacy.updated_at
FROM staged_blocks legacy
JOIN legacy_district_map map ON map.legacy_district_id = legacy.district_id
JOIN gis.data_sources source
  ON source.code = 'legacy_catastro:' || md5(lower(btrim(legacy.source)))
WHERE legacy.is_eligible
ON CONFLICT (id) DO UPDATE SET
  district_id = EXCLUDED.district_id,
  block_code = EXCLUDED.block_code,
  external_id = EXCLUDED.external_id,
  source_id = EXCLUDED.source_id,
  geom = EXCLUDED.geom,
  topology_status = 'PENDING',
  source_updated_at = EXCLUDED.source_updated_at,
  updated_at = EXCLUDED.updated_at;

-- Se transforma una sola vez y se resuelve el bloque padre antes de evaluar
-- solapamientos. Solo se reasigna cuando existe una manzana del mismo distrito
-- que contiene completamente al lote; de lo contrario queda en cuarentena.
CREATE TEMP TABLE staged_lots ON COMMIT DROP AS
SELECT
  legacy.*,
  ST_Transform(ST_Force2D(legacy.geom), 32718)::geometry(MultiPolygon, 32718)
    AS target_geom,
  resolved.block_id AS resolved_block_id,
  CASE
    WHEN ST_IsEmpty(legacy.geom) OR NOT ST_IsValid(legacy.geom) THEN 'INVALID_SOURCE_GEOMETRY'
    WHEN parent.id IS NULL THEN 'INVALID_OR_MISSING_PARENT_BLOCK'
    WHEN ST_IsEmpty(ST_Transform(ST_Force2D(legacy.geom), 32718))
      OR NOT ST_IsValid(ST_Transform(ST_Force2D(legacy.geom), 32718))
      THEN 'INVALID_TRANSFORMED_GEOMETRY'
    WHEN resolved.block_id IS NULL THEN 'OUTSIDE_PARENT_BLOCK'
    ELSE NULL
  END AS rejection_reason
FROM public.gis_lots legacy
LEFT JOIN staged_blocks parent
  ON parent.id = legacy.block_id
 AND parent.district_id = legacy.district_id
 AND parent.is_eligible
LEFT JOIN LATERAL (
  SELECT candidate.id AS block_id
  FROM staged_blocks candidate
  WHERE candidate.is_eligible
    AND candidate.district_id = legacy.district_id
    AND candidate.target_geom && ST_Transform(ST_Force2D(legacy.geom), 32718)
    AND (
      ST_CoveredBy(
        ST_Transform(ST_Force2D(legacy.geom), 32718),
        candidate.target_geom
      )
      OR ST_Area(ST_Difference(
        ST_Transform(ST_Force2D(legacy.geom), 32718),
        candidate.target_geom
      )) <= 0.000001
    )
  ORDER BY (candidate.id = legacy.block_id) DESC,
           ST_Area(candidate.target_geom),
           candidate.id
  LIMIT 1
) resolved ON ST_IsValid(legacy.geom) AND NOT ST_IsEmpty(legacy.geom);

CREATE INDEX staged_lots_geom_gix ON staged_lots USING gist (target_geom);
CREATE INDEX staged_lots_resolved_block_idx ON staged_lots (resolved_block_id);

INSERT INTO gis.migration_quarantine (
  source_table, source_id, reason_code, reason_detail, legacy_geom
)
SELECT
  'public.gis_lots',
  id::text,
  rejection_reason,
  CASE rejection_reason
    WHEN 'OUTSIDE_PARENT_BLOCK' THEN
      'El lote no esta contenido en su manzana asignada ni en otra manzana valida del distrito'
    WHEN 'INVALID_OR_MISSING_PARENT_BLOCK' THEN
      'La manzana asignada no existe, pertenece a otro distrito o fue puesta en cuarentena'
    ELSE 'El lote no cumple las restricciones geometricas del esquema operativo'
  END,
  geom
FROM staged_lots
WHERE rejection_reason IS NOT NULL
ON CONFLICT (source_table, source_id, reason_code) DO UPDATE SET
  reason_detail = EXCLUDED.reason_detail,
  legacy_geom = EXCLUDED.legacy_geom,
  quarantined_at = now();

CREATE TEMP TABLE overlapping_lots (
  lot_id uuid PRIMARY KEY,
  conflicting_lot_id uuid NOT NULL
) ON COMMIT DROP;

-- Ante cada par solapado se conserva de forma determinista el UUID menor. La
-- regla elimina al UUID mayor de cada arista del grafo de conflictos, de modo
-- que ningun par solapado puede sobrevivir completo en el conjunto operativo.
INSERT INTO overlapping_lots (lot_id, conflicting_lot_id)
SELECT DISTINCT ON (candidate.id)
  candidate.id,
  other.id
FROM staged_lots candidate
JOIN staged_lots other
  ON other.district_id = candidate.district_id
 AND other.id < candidate.id
 AND other.rejection_reason IS NULL
 AND other.target_geom && candidate.target_geom
 AND ST_Intersects(other.target_geom, candidate.target_geom)
 AND ST_Area(ST_Intersection(other.target_geom, candidate.target_geom)) > 0.000001
WHERE candidate.rejection_reason IS NULL
ORDER BY candidate.id, other.id;

INSERT INTO gis.migration_quarantine (
  source_table, source_id, reason_code, reason_detail, legacy_geom
)
SELECT
  'public.gis_lots',
  lot.id::text,
  'OVERLAPS_ADJACENT_LOT',
  'Se solapa por encima de 0.000001 m2 con el lote ' || conflict.conflicting_lot_id,
  lot.geom
FROM staged_lots lot
JOIN overlapping_lots conflict ON conflict.lot_id = lot.id
ON CONFLICT (source_table, source_id, reason_code) DO UPDATE SET
  reason_detail = EXCLUDED.reason_detail,
  legacy_geom = EXCLUDED.legacy_geom,
  quarantined_at = now();

-- El trigger estricto permanece habilitado durante toda la carga y constituye
-- la ultima barrera ante cualquier inconsistencia no detectada en staging.
INSERT INTO gis.lots (
  id, district_id, block_id, lot_code, cadastral_code, external_id, source_id,
  geom, topology_status, source_updated_at, updated_at
)
SELECT
  legacy.id,
  map.target_district_id,
  legacy.resolved_block_id,
  legacy.lot_code,
  COALESCE(legacy.cup_code, legacy.property_code),
  COALESCE(legacy.global_id::text, legacy.source_object_id::text),
  source.id,
  legacy.target_geom,
  'PENDING',
  legacy.source_updated_at,
  legacy.updated_at
FROM staged_lots legacy
JOIN legacy_district_map map ON map.legacy_district_id = legacy.district_id
JOIN gis.data_sources source
  ON source.code = 'legacy_catastro:' || md5(lower(btrim(legacy.source)))
LEFT JOIN overlapping_lots conflict ON conflict.lot_id = legacy.id
WHERE legacy.rejection_reason IS NULL
  AND conflict.lot_id IS NULL
ON CONFLICT (id) DO UPDATE SET
  district_id = EXCLUDED.district_id,
  block_id = EXCLUDED.block_id,
  lot_code = EXCLUDED.lot_code,
  cadastral_code = EXCLUDED.cadastral_code,
  external_id = EXCLUDED.external_id,
  source_id = EXCLUDED.source_id,
  geom = EXCLUDED.geom,
  topology_status = 'PENDING',
  source_updated_at = EXCLUDED.source_updated_at,
  updated_at = EXCLUDED.updated_at;

ANALYZE gis.districts;
ANALYZE gis.blocks;
ANALYZE gis.lots;

COMMIT;
