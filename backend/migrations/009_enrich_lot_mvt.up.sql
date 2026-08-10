BEGIN;

CREATE OR REPLACE FUNCTION mvt.lots(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog, public
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

COMMENT ON FUNCTION mvt.lots(integer, integer, integer) IS
'{"name":"lots","minzoom":15,"maxzoom":22,"description":"Lotes catastrales con atributos operativos"}';

REVOKE ALL ON FUNCTION mvt.lots(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mvt.lots(integer, integer, integer) TO sedapalgis_martin;

COMMIT;
