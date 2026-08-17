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
  ), corrected AS (
    SELECT
      l.id,
      l.block_id,
      l.district_id,
      l.lot_code,
      l.cup_code,
      l.cod_mza,
      l.property_code,
      l.locality_code,
      l.lot_type_code,
      l.project_status,
      l.levels,
      l.block_match_method,
      l.source,
      l.geom,
      ST_Transform(
        ST_Translate(
          ST_Transform(l.geom, 4326),
          COALESCE(block_correction.delta_lng, 0) + COALESCE(lot_correction.delta_lng, 0),
          COALESCE(block_correction.delta_lat, 0) + COALESCE(lot_correction.delta_lat, 0)
        ),
        3857
      ) AS geom_3857
    FROM public.gis_lots l
    LEFT JOIN public.gis_geometry_corrections block_correction
      ON block_correction.target_kind = 'block'
     AND block_correction.block_id = l.block_id
    LEFT JOIN public.gis_geometry_corrections lot_correction
      ON lot_correction.target_kind = 'lot'
     AND lot_correction.lot_id = l.id
    CROSS JOIN bounds
    WHERE $1 >= 15
      -- Dos ajustes acumulados pueden desplazar el lote hasta 30 m. El margen
      -- evita perderlo cuando cruza el borde de una tesela tras la correccion.
      AND l.geom && ST_Expand(ST_Transform(bounds.geom_3857, 4326), 0.0003)
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
      l.cup_code,
      l.cod_mza,
      l.property_code,
      l.locality_code,
      l.lot_type_code,
      l.project_status,
      l.levels,
      ST_Area(l.geom::geography)::double precision AS area_m2,
      ST_Perimeter(l.geom::geography)::double precision AS perimeter_m,
      l.block_match_method,
      l.source,
      ST_AsMVTGeom(l.geom_3857, bounds.geom_3857, 4096, 16, true) AS geom
    FROM corrected l
    JOIN public.gis_districts d ON d.id = l.district_id
    LEFT JOIN public.gis_blocks b ON b.id = l.block_id
    CROSS JOIN bounds
  )
  SELECT COALESCE(ST_AsMVT(features, 'lots', 4096, 'geom'), '\x'::bytea)
  FROM features
  WHERE geom IS NOT NULL;
$$;

COMMENT ON FUNCTION mvt.lots(integer, integer, integer) IS
'{"name":"lots","minzoom":15,"maxzoom":22,"description":"Lotes catastrales con ajustes de manzana y lote"}';

REVOKE ALL ON FUNCTION mvt.lots(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mvt.lots(integer, integer, integer) TO sedapalgis_martin;

COMMIT;
