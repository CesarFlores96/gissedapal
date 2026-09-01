"""Importa XLS de red de agua y recupera su geometría desde ArcGIS.

Los XLS son exportaciones HTML: contienen atributos y GLOBALID, pero no la
geometría. El GLOBALID/FACILITYID se usa para consultar movilAP y las líneas
se almacenan en EPSG:4326, que es el CRS del contrato GIS de esta aplicación.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import psycopg

ARCGIS_BASE = "https://gisprdsdp.sedapal.com.pe/arcgis/rest/services/movilAP/MapServer"
ROW_PATTERN = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
CELL_PATTERN = re.compile(r"<t[dh]\b[^>]*>(.*?)(?=<t[dh]\b[^>]*>|$)", re.I | re.S)
TAG_PATTERN = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Record:
    asset_code: str
    globalid: str
    district: str
    layer_id: int
    diameter: float | None
    material: str | None
    network_type: str
    network_level: str
    condition: str
    length_m: float | None
    attributes: dict[str, str]


def clean(value: str) -> str:
    return " ".join(html.unescape(TAG_PATTERN.sub("", value)).split()).strip()


def read_rows(path: Path) -> list[dict[str, str]]:
    content = path.read_text(encoding="utf-8", errors="strict")
    rows: list[dict[str, str]] = []
    raw_rows = ROW_PATTERN.findall(content)
    if not raw_rows:
        raise ValueError(f"{path.name}: no contiene filas HTML")
    headers = [clean(cell).lower() for cell in CELL_PATTERN.findall(raw_rows[0])]
    for raw in raw_rows[1:]:
        values = [clean(cell) for cell in CELL_PATTERN.findall(raw)]
        if len(values) != len(headers) or not values[0]:
            continue
        rows.append(dict(zip(headers, values, strict=True)))
    return rows


def number(value: str) -> float | None:
    try:
        return float(value.replace(",", ".")) if value else None
    except ValueError:
        return None


def material(value: str) -> str:
    return {"HD": "HDPE", "PEAD": "HDPE", "FOFO": "FD", "AR": "AC", "ACER": "AC"}.get(value.upper(), value.upper())


def condition(value: str) -> str:
    return {"BUE": "bueno", "REG": "regular", "MAL": "malo", "EXC": "critico"}.get(value.upper(), "regular")


def records_from(path: Path) -> list[Record]:
    records: list[Record] = []
    for row in read_rows(path):
        code = row.get("identificador", "")
        gid = row.get("globalid", "").strip("{} ").lower()
        if not code or len(gid) != 36:
            continue
        is_primary = row.get("red primaria", "") == "1"
        records.append(Record(
            asset_code=code,
            globalid=gid,
            district=row.get("distrito", "").zfill(3),
            layer_id=5 if is_primary else 6,
            diameter=number(row.get("diámetro", "")),
            material=material(row.get("material", "")),
            network_type="agua_potable",
            network_level="primaria" if is_primary else "secundaria",
            condition=condition(row.get("condición de conservación", "")),
            length_m=number(row.get("shape_length", "")) or number(row.get("longitud real", "")),
            attributes=row,
        ))
    if not records:
        raise ValueError(f"{path.name}: no contiene líneas reconocibles")
    return records


def arcgis_lines(records: list[Record]) -> dict[str, dict[str, Any]]:
    async def fetch() -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            for layer_id in sorted({record.layer_id for record in records}):
                layer_records = [record for record in records if record.layer_id == layer_id]
                for start in range(0, len(layer_records), 100):
                    batch = layer_records[start:start + 100]
                    where = "GLOBALID IN (" + ",".join(f"'{record.globalid}'" for record in batch) + ")"
                    response = await client.get(
                        f"{ARCGIS_BASE}/{layer_id}/query",
                        params={"where": where, "outFields": "*", "returnGeometry": "true", "f": "json"},
                    )
                    response.raise_for_status()
                    payload = response.json()
                    if "error" in payload:
                        raise RuntimeError(f"ArcGIS layer {layer_id}: {payload['error']}")
                    for feature in payload.get("features", []):
                        attrs = feature.get("attributes", {})
                        geometry = feature.get("geometry", {})
                        paths = geometry.get("paths") or []
                        if attrs.get("GLOBALID") and paths:
                            result[attrs["GLOBALID"].strip("{} ").lower()] = {
                                "attributes": attrs,
                                "paths": paths,
                                "layer_id": layer_id,
                            }
        return result

    return asyncio.run(fetch())


def import_records(records: list[Record], geometries: dict[str, dict[str, Any]], dry_run: bool) -> tuple[int, int]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL no está configurada")
    missing = [record.asset_code for record in records if record.globalid not in geometries]
    if missing:
        raise RuntimeError(f"ArcGIS no devolvió geometría para {len(missing)} registros; primer código: {missing[0]}")
    pipes = [record for record in records if record.layer_id in (5, 6)]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for record in pipes:
                source = geometries[record.globalid]
                geometry_json = json.dumps({"type": "MultiLineString", "coordinates": source["paths"]})
                cursor.execute(
                    """
                    INSERT INTO public.network_pipes (
                      network_type, network_level, material, diameter_mm, condition,
                      length_m, geom, source_system, source_asset_code, source_globalid,
                      source_layer_id, source_district_code, source_attributes, notes
                    ) VALUES (
                      %s::network_type, %s::network_level, %s::pipe_material, %s, %s::asset_condition,
                      %s, ST_LineMerge(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 32718), 4326)), %s, %s, %s, %s, %s, %s::jsonb, %s
                    )
                    ON CONFLICT (source_system, source_globalid) DO UPDATE SET
                      network_level = EXCLUDED.network_level, material = EXCLUDED.material,
                      diameter_mm = EXCLUDED.diameter_mm, condition = EXCLUDED.condition,
                      length_m = EXCLUDED.length_m, geom = EXCLUDED.geom,
                      source_asset_code = EXCLUDED.source_asset_code,
                      source_layer_id = EXCLUDED.source_layer_id,
                      source_district_code = EXCLUDED.source_district_code,
                      source_attributes = EXCLUDED.source_attributes,
                      updated_at = now()
                    """,
                    [record.network_type, record.network_level, record.material, record.diameter,
                     record.condition, record.length_m, geometry_json, "SEDAPAL_ARCGIS_MOVILAP",
                     record.asset_code, record.globalid, record.layer_id, record.district,
                     json.dumps(record.attributes), f"Importado desde {record.layer_id} / {record.district}"],
                )
        if dry_run:
            connection.rollback()
        else:
            connection.commit()
    return len(pipes), len(missing)


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa líneas de agua XLS con geometría ArcGIS")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    records = [record for path in args.files for record in records_from(path)]
    unique = {record.globalid: record for record in records}
    geometries = arcgis_lines(list(unique.values()))
    imported, missing = import_records(list(unique.values()), geometries, args.dry_run)
    print(f"{'Dry-run' if args.dry_run else 'Importación'} correcta: {imported} tuberías, geometrías faltantes: {missing}")


if __name__ == "__main__":
    main()
