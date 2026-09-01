"""Importa tuberias_conexion_*.xls como acometidas domiciliarias.

El XLS aporta atributos; la geometría oficial se recupera de movilAP/4
(Acometidas) por GLOBALID/FACILITYID y se guarda en PostGIS en EPSG:4326.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
from pathlib import Path
from typing import Any

import httpx
import psycopg

ARCGIS_URL = "https://gisprdsdp.sedapal.com.pe/arcgis/rest/services/movilAP/MapServer/4/query"
ROW_PATTERN = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
CELL_PATTERN = re.compile(r"<t[dh]\b[^>]*>(.*?)(?=<t[dh]\b[^>]*>|$)", re.I | re.S)
TAG_PATTERN = re.compile(r"<[^>]+>")


def clean(value: str) -> str:
    return " ".join(html.unescape(TAG_PATTERN.sub("", value)).split()).strip()


def read_records(path: Path) -> list[dict[str, str]]:
    content = path.read_text(encoding="utf-8", errors="strict")
    raw_rows = ROW_PATTERN.findall(content)
    headers = [clean(cell).lower() for cell in CELL_PATTERN.findall(raw_rows[0])]
    rows: list[dict[str, str]] = []
    for raw in raw_rows[1:]:
        values = [clean(cell) for cell in CELL_PATTERN.findall(raw)]
        if len(values) == len(headers) and values[0] and values[21]:
            rows.append(dict(zip(headers, values, strict=True)))
    if not rows:
        raise ValueError(f"{path.name}: no contiene conexiones reconocibles")
    return rows


def number(value: str) -> float | None:
    try:
        return float(value.replace(",", ".")) if value else None
    except ValueError:
        return None


def fetch_geometries(records: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    async def run() -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            for start in range(0, len(records), 100):
                batch = records[start:start + 100]
                where = "GLOBALID IN (" + ",".join(
                    f"'{row['globalid'].strip('{} ').lower()}'" for row in batch
                ) + ")"
                response = await client.get(ARCGIS_URL, params={
                    "where": where, "outFields": "*", "returnGeometry": "true", "f": "json",
                })
                response.raise_for_status()
                payload = response.json()
                if "error" in payload:
                    raise RuntimeError(f"ArcGIS: {payload['error']}")
                for feature in payload.get("features", []):
                    attrs = feature.get("attributes", {})
                    paths = (feature.get("geometry") or {}).get("paths") or []
                    gid = str(attrs.get("GLOBALID", "")).strip("{} ").lower()
                    if gid and paths:
                        result[gid] = {"attrs": attrs, "paths": paths}
        return result
    return asyncio.run(run())


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa conexiones domiciliarias desde XLS + ArcGIS")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    rows_by_gid = {}
    for path in args.files:
        rows_by_gid.update({row["globalid"].strip("{} ").lower(): row for row in read_records(path)})
    rows = list(rows_by_gid.values())
    geometries = fetch_geometries(rows)
    missing = [row["identificador"] for row in rows if row["globalid"].strip("{} ").lower() not in geometries]
    if missing:
        raise RuntimeError(f"ArcGIS no devolvió geometría para {len(missing)} conexiones; primer código: {missing[0]}")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL no está configurada")
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for row in rows:
                gid = row["globalid"].strip("{} ").lower()
                geo = json.dumps({"type": "MultiLineString", "coordinates": geometries[gid]["paths"]})
                status = "ACTIVE" if row.get("activo") == "1" else "OUT_OF_SERVICE"
                cursor.execute(
                    """
                    INSERT INTO public.network_service_connections (
                      asset_code, diameter_mm, material, status, source_system,
                      source_globalid, source_layer_id, source_district_code,
                      source_attributes, geom
                    ) VALUES (
                      %s, %s, %s, %s, 'SEDAPAL_ARCGIS_MOVILAP', %s, 4, %s, %s::jsonb,
                      ST_LineMerge(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 32718), 4326))
                    )
                    ON CONFLICT (source_system, source_globalid) DO UPDATE SET
                      asset_code = EXCLUDED.asset_code, diameter_mm = EXCLUDED.diameter_mm,
                      material = EXCLUDED.material, status = EXCLUDED.status,
                      source_district_code = EXCLUDED.source_district_code,
                      source_attributes = EXCLUDED.source_attributes, geom = EXCLUDED.geom,
                      updated_at = now()
                    """,
                    [row["identificador"], number(row.get("diámetro", "")), row.get("material") or None,
                     status, gid, row.get("distrito", "").zfill(3), json.dumps(row), geo],
                )
        if args.dry_run:
            connection.rollback()
        else:
            connection.commit()
    print(f"{'Dry-run' if args.dry_run else 'Importación'} correcta: {len(rows)} conexiones, geometrías faltantes: {len(missing)}")


if __name__ == "__main__":
    main()
