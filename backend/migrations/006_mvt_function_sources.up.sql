BEGIN;

-- Fuentes MVT para Martin. La geometria operativa permanece en EPSG:32718;
-- cada funcion usa el indice GiST contra el bbox transformado a 32718 y solo
-- transforma a EPSG:3857 las entidades candidatas del tile.
CREATE SCHEMA IF NOT EXISTS mvt;

CREATE OR REPLACE FUNCTION mvt.districts(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      d.id::text AS id,
      d.district_code,
      d.name,
      ST_AsMVTGeom(
        ST_Transform(d.geom, 3857), bounds.geom_3857, 4096, 64, true
      ) AS geom
    FROM gis.districts d
    CROSS JOIN bounds
    WHERE $1 >= 7
      AND d.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'districts', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.blocks(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      b.id::text AS id,
      d.district_code,
      b.block_code,
      ST_AsMVTGeom(
        ST_Transform(b.geom, 3857), bounds.geom_3857, 4096, 32, true
      ) AS geom
    FROM gis.blocks b
    JOIN gis.districts d ON d.id = b.district_id
    CROSS JOIN bounds
    WHERE $1 >= 12
      AND b.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'blocks', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.lots(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      l.id::text AS id,
      l.id::text AS record_id,
      l.block_id::text AS block_id,
      d.name AS district,
      d.district_code,
      b.block_code,
      l.lot_code,
      right(l.lot_code, 4) AS display_code,
      legacy.cup_code,
      legacy.cod_mza,
      legacy.property_code,
      legacy.locality_code,
      legacy.lot_type_code,
      legacy.project_status,
      legacy.levels,
      ST_Area(l.geom)::double precision AS area_m2,
      ST_Perimeter(l.geom)::double precision AS perimeter_m,
      legacy.block_match_method,
      source.code AS source,
      ST_AsMVTGeom(
        ST_Transform(l.geom, 3857), bounds.geom_3857, 4096, 16, true
      ) AS geom
    FROM gis.lots l
    JOIN gis.districts d ON d.id = l.district_id
    JOIN gis.blocks b ON b.id = l.block_id
    LEFT JOIN public.gis_lots legacy ON legacy.id = l.id
    LEFT JOIN gis.data_sources source ON source.id = l.source_id
    CROSS JOIN bounds
    WHERE $1 >= 15
      AND l.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'lots', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.water_pipes(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      p.id::text AS id,
      p.pipe_class,
      p.material,
      p.diameter_mm,
      p.status,
      ST_AsMVTGeom(
        ST_Transform(p.geom, 3857), bounds.geom_3857, 4096, 32, true
      ) AS geom
    FROM utility.pipes p
    CROSS JOIN bounds
    WHERE $1 >= 12
      AND p.status = 'ACTIVE'
      AND p.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'water_pipes', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.water_connections(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      c.id::text AS id,
      c.pipe_id::text AS pipe_id,
      c.diameter_mm,
      c.status,
      ST_AsMVTGeom(
        ST_Transform(c.geom, 3857), bounds.geom_3857, 4096, 16, true
      ) AS geom
    FROM utility.service_connections c
    CROSS JOIN bounds
    WHERE $1 >= 16
      AND c.status = 'ACTIVE'
      AND c.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'water_connections', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.valves(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      v.id::text AS id,
      v.valve_type,
      v.current_position,
      v.operable,
      v.status,
      ST_AsMVTGeom(
        ST_Transform(v.geom, 3857), bounds.geom_3857, 4096, 64, true
      ) AS geom
    FROM utility.valves v
    CROSS JOIN bounds
    WHERE $1 >= 14
      AND v.status = 'ACTIVE'
      AND v.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'valves', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mvt.supplies(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
  ), features AS (
    SELECT
      s.id::text AS id,
      s.lot_id::text AS lot_id,
      s.service_status,
      ST_AsMVTGeom(
        ST_Transform(s.geom, 3857), bounds.geom_3857, 4096, 64, true
      ) AS geom
    FROM utility.supplies s
    CROSS JOIN bounds
    WHERE $1 >= 16
      AND s.service_status = 'ACTIVE'
      AND s.geom && ST_Transform(bounds.geom_3857, 32718)
  )
  SELECT COALESCE(ST_AsMVT(features, 'supplies', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

-- Metadatos TileJSON para que Martin no calcule los limites en cada reinicio.
COMMENT ON FUNCTION mvt.districts(integer, integer, integer) IS
'{"name":"districts","minzoom":7,"maxzoom":22,"description":"Limites distritales"}';
COMMENT ON FUNCTION mvt.blocks(integer, integer, integer) IS
'{"name":"blocks","minzoom":12,"maxzoom":22,"description":"Manzanas catastrales"}';
COMMENT ON FUNCTION mvt.lots(integer, integer, integer) IS
'{"name":"lots","minzoom":15,"maxzoom":22,"description":"Lotes catastrales"}';
COMMENT ON FUNCTION mvt.water_pipes(integer, integer, integer) IS
'{"name":"water_pipes","minzoom":12,"maxzoom":22,"description":"Tuberias activas"}';
COMMENT ON FUNCTION mvt.water_connections(integer, integer, integer) IS
'{"name":"water_connections","minzoom":16,"maxzoom":22,"description":"Acometidas activas"}';
COMMENT ON FUNCTION mvt.valves(integer, integer, integer) IS
'{"name":"valves","minzoom":14,"maxzoom":22,"description":"Valvulas activas"}';
COMMENT ON FUNCTION mvt.supplies(integer, integer, integer) IS
'{"name":"supplies","minzoom":16,"maxzoom":22,"description":"Suministros activos"}';

COMMIT;
