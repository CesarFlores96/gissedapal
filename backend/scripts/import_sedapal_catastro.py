import argparse
import asyncio
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from psycopg.types.json import Jsonb

from app.database import close_pool, get_pool, open_pool

ARCGIS_SERVICE_URL = (
    "https://gisprdsdp.sedapal.com.pe/arcgis/rest/services/"
    "Print/CatastroComercial/MapServer"
)
SOURCE = "SEDAPAL_ARCGIS_CATASTRO_COMERCIAL"
DERIVED_SOURCE = "SEDAPAL_ARCGIS_DERIVED_FROM_LOTS"
PAGE_SIZE = 1000


@dataclass(frozen=True)
class LayerDefinition:
    layer_id: int
    name: str
    fields: str


BLOCKS = LayerDefinition(
    layer_id=13,
    name="manzanas",
    fields=(
        "OBJECTID,DISTRICTCODE,SQUARECODE,GLOBALID,STATUSSOCIAL,"
        "SQUAREPROPERTYCODE,LASTUPDATE,LASTEDITOR,SQUARETYPE"
    ),
)
LOTS = LayerDefinition(
    layer_id=12,
    name="lotes",
    fields=(
        "OBJECTID,DISTRICTCODE,SQUARECODE,PARCELCODE,LOCALITYCODE,LEVELS,"
        "PARCELTYPE,PROJECTSTATUS,GLOBALID,SAPCODE,CUPCODE,COD_MZA,"
        "PROPERTYCODE,LASTUPDATE,LASTEDITOR"
    ),
)


def normalize_guid(value: Any) -> str:
    normalized = str(value or "").strip().strip("{}").lower()
    if len(normalized) != 36:
        raise ValueError(f"GLOBALID invalido: {value!r}")
    return normalized


def optional_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def parse_arcgis_date(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(int(value) / 1000, tz=UTC)


def require_geometry(feature: dict[str, Any], layer_name: str) -> dict[str, Any]:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError(f"{layer_name}: geometria ausente o no poligonal")
    if not geometry.get("coordinates"):
        raise ValueError(f"{layer_name}: geometria vacia")
    return geometry


async def fetch_json(
    client: httpx.AsyncClient, url: str, params: dict[str, str | int]
) -> dict[str, Any]:
    response = await client.get(url, params=params)
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"ArcGIS devolvio un error: {payload['error']}")
    return payload


async def download_layer(
    client: httpx.AsyncClient, definition: LayerDefinition, district_code: str
) -> list[dict[str, Any]]:
    url = f"{ARCGIS_SERVICE_URL}/{definition.layer_id}/query"
    where = f"DISTRICTCODE='{district_code}'"
    count_payload = await fetch_json(
        client, url, {"where": where, "returnCountOnly": "true", "f": "json"}
    )
    expected = int(count_payload.get("count", -1))
    if expected < 0:
        raise RuntimeError(f"No se obtuvo el conteo de {definition.name}")

    features: list[dict[str, Any]] = []
    offset = 0
    while offset < expected:
        payload = await fetch_json(
            client,
            url,
            {
                "where": where,
                "outFields": definition.fields,
                "returnGeometry": "true",
                "outSR": 4326,
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
                "f": "geojson",
            },
        )
        page = payload.get("features") or []
        if not page:
            raise RuntimeError(
                f"Descarga incompleta de {definition.name}: {len(features)} de {expected}"
            )
        features.extend(page)
        offset += len(page)

    if len(features) != expected:
        raise RuntimeError(
            f"Conteo inconsistente de {definition.name}: {len(features)} de {expected}"
        )
    object_ids = [feature.get("properties", {}).get("OBJECTID") for feature in features]
    if None in object_ids or len(set(object_ids)) != expected:
        raise RuntimeError(f"OBJECTID duplicado o ausente en {definition.name}")
    return features


async def import_catastro(
    district_code: str,
    blocks: list[dict[str, Any]],
    lots: list[dict[str, Any]],
) -> dict[str, int]:
    async with get_pool().connection() as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT id FROM public.gis_districts
                    WHERE district_code = %s OR (%s = '010' AND upper(name) = 'EL AGUSTINO')
                    ORDER BY district_code NULLS LAST
                    LIMIT 1
                    """,
                    [district_code, district_code],
                )
                district = await cursor.fetchone()
                if not district:
                    raise RuntimeError(f"Distrito {district_code} no existe en gis_districts")
                district_id = district[0]
                await cursor.execute(
                    "UPDATE public.gis_districts SET district_code = %s WHERE id = %s",
                    [district_code, district_id],
                )

                await cursor.execute(
                    """
                    CREATE TEMP TABLE stage_blocks (
                      source_object_id bigint PRIMARY KEY,
                      block_code text NOT NULL,
                      global_id uuid NOT NULL UNIQUE,
                      property_code text,
                      block_type_code text,
                      source_updated_at timestamptz,
                      properties jsonb NOT NULL,
                      geom geometry(MultiPolygon, 4326) NOT NULL
                    ) ON COMMIT DROP;
                    CREATE TEMP TABLE stage_lots (
                      source_object_id bigint PRIMARY KEY,
                      block_code text NOT NULL,
                      lot_code text NOT NULL UNIQUE,
                      global_id uuid NOT NULL UNIQUE,
                      cup_code text,
                      cod_mza text,
                      property_code text,
                      locality_code text,
                      lot_type_code text,
                      project_status text,
                      levels integer,
                      source_updated_at timestamptz,
                      properties jsonb NOT NULL,
                      geom geometry(MultiPolygon, 4326) NOT NULL
                    ) ON COMMIT DROP
                    """
                )

                for feature in blocks:
                    properties = feature.get("properties") or {}
                    geometry = require_geometry(feature, BLOCKS.name)
                    await cursor.execute(
                        """
                        INSERT INTO stage_blocks
                          (source_object_id, block_code, global_id, property_code,
                           block_type_code, source_updated_at, properties, geom)
                        VALUES (%s, %s, %s, %s, %s, %s, %s,
                          ST_Multi(ST_CollectionExtract(ST_MakeValid(
                            ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                          ), 3)))
                        """,
                        [
                            properties["OBJECTID"],
                            str(properties["SQUARECODE"]),
                            normalize_guid(properties["GLOBALID"]),
                            optional_text(properties.get("SQUAREPROPERTYCODE")),
                            optional_text(properties.get("SQUARETYPE")),
                            parse_arcgis_date(properties.get("LASTUPDATE")),
                            Jsonb(properties),
                            json.dumps(geometry),
                        ],
                    )

                for feature in lots:
                    properties = feature.get("properties") or {}
                    geometry = require_geometry(feature, LOTS.name)
                    await cursor.execute(
                        """
                        INSERT INTO stage_lots
                          (source_object_id, block_code, lot_code, global_id, cup_code,
                           cod_mza, property_code, locality_code, lot_type_code,
                           project_status, levels, source_updated_at, properties, geom)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                          ST_Multi(ST_CollectionExtract(ST_MakeValid(
                            ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                          ), 3)))
                        """,
                        [
                            properties["OBJECTID"],
                            str(properties["SQUARECODE"]),
                            str(properties["PARCELCODE"]),
                            normalize_guid(properties["GLOBALID"]),
                            optional_text(properties.get("CUPCODE")),
                            optional_text(properties.get("COD_MZA")),
                            optional_text(properties.get("PROPERTYCODE")),
                            optional_text(properties.get("LOCALITYCODE")),
                            optional_text(properties.get("PARCELTYPE")),
                            optional_text(properties.get("PROJECTSTATUS")),
                            properties.get("LEVELS"),
                            parse_arcgis_date(properties.get("LASTUPDATE")),
                            Jsonb(properties),
                            json.dumps(geometry),
                        ],
                    )

                await cursor.execute(
                    """
                    SELECT
                      count(*) FILTER (WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom)),
                      (SELECT count(*) FROM stage_lots
                       WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom))
                    FROM stage_blocks
                    """
                )
                invalid_blocks, invalid_lots = await cursor.fetchone()
                if invalid_blocks or invalid_lots:
                    raise RuntimeError(
                        f"Geometrias invalidas: {invalid_blocks} manzanas, {invalid_lots} lotes"
                    )

                await cursor.execute(
                    """
                    INSERT INTO public.gis_blocks
                      (district_id, block_code, global_id, source_object_id, property_code,
                       block_type_code, source, source_updated_at, geom, properties,
                       synced_at, updated_at)
                    SELECT %s, block_code, global_id, source_object_id, property_code,
                           block_type_code, %s, source_updated_at, geom, properties, now(), now()
                    FROM stage_blocks
                    ON CONFLICT (source, global_id) DO UPDATE SET
                      district_id = EXCLUDED.district_id,
                      block_code = EXCLUDED.block_code,
                      source_object_id = EXCLUDED.source_object_id,
                      property_code = EXCLUDED.property_code,
                      block_type_code = EXCLUDED.block_type_code,
                      source_updated_at = EXCLUDED.source_updated_at,
                      geom = EXCLUDED.geom,
                      properties = EXCLUDED.properties,
                      synced_at = now(),
                      updated_at = now()
                    """,
                    [district_id, SOURCE],
                )

                await cursor.execute(
                    """
                    DELETE FROM public.gis_blocks b
                    WHERE b.source = %s AND b.district_id = %s
                      AND NOT EXISTS (
                        SELECT 1
                        FROM stage_lots l
                        LEFT JOIN stage_blocks official
                          ON official.block_code = l.block_code
                        WHERE official.block_code IS NULL
                          AND l.block_code = b.block_code
                      )
                    """,
                    [DERIVED_SOURCE, district_id],
                )
                await cursor.execute(
                    """
                    INSERT INTO public.gis_blocks
                      (district_id, block_code, global_id, source_object_id, property_code,
                       block_type_code, source, geom, properties, synced_at, updated_at)
                    SELECT %s, l.block_code,
                           md5(%s || ':' || %s || ':' || l.block_code)::uuid,
                           -abs(hashtextextended(l.block_code, 0)), NULL, 'DERIVED_FROM_LOTS',
                           %s,
                           ST_Multi(ST_CollectionExtract(ST_MakeValid(
                             ST_UnaryUnion(ST_Collect(l.geom))
                           ), 3)),
                           jsonb_build_object(
                             'derived', true,
                             'reason', 'missing_official_block',
                             'lot_count', count(*)
                           ),
                           now(), now()
                    FROM stage_lots l
                    LEFT JOIN stage_blocks official ON official.block_code = l.block_code
                    WHERE official.block_code IS NULL
                    GROUP BY l.block_code
                    ON CONFLICT (source, global_id) DO UPDATE SET
                      geom = EXCLUDED.geom,
                      properties = EXCLUDED.properties,
                      synced_at = now(),
                      updated_at = now()
                    """,
                    [district_id, DERIVED_SOURCE, district_code, DERIVED_SOURCE],
                )

                await cursor.execute(
                    """
                    INSERT INTO public.gis_lots
                      (district_id, block_id, lot_code, source, geom, properties,
                       global_id, source_object_id, cup_code, cod_mza, property_code,
                       locality_code, lot_type_code, project_status, levels,
                       source_updated_at, block_match_method, synced_at, updated_at)
                    SELECT %s, b.id, l.lot_code, %s, l.geom, l.properties,
                           l.global_id, l.source_object_id, l.cup_code, l.cod_mza,
                           l.property_code, l.locality_code, l.lot_type_code,
                           l.project_status, l.levels, l.source_updated_at,
                           CASE WHEN b.id IS NULL THEN NULL ELSE 'code' END, now(), now()
                    FROM stage_lots l
                    LEFT JOIN public.gis_blocks b
                      ON b.source IN (%s, %s) AND b.district_id = %s
                     AND b.block_code = l.block_code
                    ON CONFLICT (source, lot_code) DO UPDATE SET
                      district_id = EXCLUDED.district_id,
                      block_id = EXCLUDED.block_id,
                      geom = EXCLUDED.geom,
                      properties = EXCLUDED.properties,
                      global_id = EXCLUDED.global_id,
                      source_object_id = EXCLUDED.source_object_id,
                      cup_code = EXCLUDED.cup_code,
                      cod_mza = EXCLUDED.cod_mza,
                      property_code = EXCLUDED.property_code,
                      locality_code = EXCLUDED.locality_code,
                      lot_type_code = EXCLUDED.lot_type_code,
                      project_status = EXCLUDED.project_status,
                      levels = EXCLUDED.levels,
                      source_updated_at = EXCLUDED.source_updated_at,
                      block_match_method = EXCLUDED.block_match_method,
                      synced_at = now(),
                      updated_at = now()
                    """,
                    [district_id, SOURCE, SOURCE, DERIVED_SOURCE, district_id],
                )

                await cursor.execute(
                    """
                    WITH spatial_matches AS (
                      SELECT DISTINCT ON (l.id) l.id AS lot_id, b.id AS block_id
                      FROM public.gis_lots l
                      JOIN public.gis_blocks b
                        ON b.source = %s AND b.district_id = %s
                       AND ST_Covers(b.geom, ST_PointOnSurface(l.geom))
                      WHERE l.source = %s AND l.district_id = %s
                        AND l.block_id IS NULL
                      ORDER BY l.id, ST_Area(b.geom::geography)
                    )
                    UPDATE public.gis_lots l
                    SET block_id = spatial_matches.block_id,
                        block_match_method = 'spatial'
                    FROM spatial_matches
                    WHERE l.id = spatial_matches.lot_id
                    """,
                    [SOURCE, district_id, SOURCE, district_id],
                )

                await cursor.execute(
                    """
                    SELECT count(*) FROM public.gis_lots
                    WHERE source = %s AND district_id = %s AND block_id IS NULL
                    """,
                    [SOURCE, district_id],
                )
                unresolved = int((await cursor.fetchone())[0])
                if unresolved:
                    raise RuntimeError(
                        f"Quedaron {unresolved} lotes sin una manzana verificable"
                    )

                await cursor.execute(
                    """
                    DELETE FROM public.gis_lots l
                    WHERE l.source = %s AND l.district_id = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM stage_lots s WHERE s.global_id = l.global_id
                      )
                    """,
                    [SOURCE, district_id],
                )
                await cursor.execute(
                    """
                    DELETE FROM public.gis_blocks b
                    WHERE b.source = %s AND b.district_id = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM stage_blocks s WHERE s.global_id = b.global_id
                      )
                    """,
                    [SOURCE, district_id],
                )

                await cursor.execute(
                    """
                    SELECT
                      (SELECT count(*) FROM public.gis_blocks
                       WHERE source = %s AND district_id = %s),
                      (SELECT count(*) FROM public.gis_blocks
                       WHERE source = %s AND district_id = %s),
                      (SELECT count(*) FROM public.gis_lots
                       WHERE source = %s AND district_id = %s),
                      (SELECT count(*) FROM public.gis_lots
                       WHERE source = %s AND district_id = %s
                         AND block_match_method = 'spatial')
                    """,
                    [
                        SOURCE,
                        district_id,
                        DERIVED_SOURCE,
                        district_id,
                        SOURCE,
                        district_id,
                        SOURCE,
                        district_id,
                    ],
                )
                imported_blocks, derived_blocks, imported_lots, spatial_matches = await cursor.fetchone()
                if imported_blocks != len(blocks) or imported_lots != len(lots):
                    raise RuntimeError(
                        "Los conteos finales no coinciden con la descarga validada"
                    )
                return {
                    "blocks": int(imported_blocks),
                    "derived_blocks": int(derived_blocks),
                    "lots": int(imported_lots),
                    "spatial_matches": int(spatial_matches),
                }


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Importa manzanas y lotes de SEDAPAL ArcGIS a PostGIS local"
    )
    parser.add_argument("--district-code", default="010")
    args = parser.parse_args()
    district_code = args.district_code.strip().zfill(3)
    if len(district_code) != 3 or not district_code.isdigit():
        raise SystemExit("--district-code debe contener tres digitos")

    timeout = httpx.Timeout(60.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        blocks, lots = await asyncio.gather(
            download_layer(client, BLOCKS, district_code),
            download_layer(client, LOTS, district_code),
        )
    print(f"Descarga validada: {len(blocks)} manzanas y {len(lots)} lotes")

    await open_pool()
    try:
        result = await import_catastro(district_code, blocks, lots)
    finally:
        await close_pool()
    print(
        "Importacion completada: "
        f"{result['blocks']} manzanas oficiales, "
        f"{result['derived_blocks']} manzanas derivadas, {result['lots']} lotes, "
        f"{result['spatial_matches']} relaciones resueltas espacialmente"
    )


if __name__ == "__main__":
    asyncio.run(main())
