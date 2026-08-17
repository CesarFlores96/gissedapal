import argparse
import asyncio
import json
import math
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

import httpx


ARCGIS_SERVICE_URL = (
    "https://gisprdsdp.sedapal.com.pe/arcgis/rest/services/"
    "Print/CatastroComercial/MapServer"
)
BLOCK_LAYER_ID = 13
PAGE_SIZE = 1000
BLOCK_FIELDS = (
    "OBJECTID,DISTRICTCODE,SQUARECODE,GLOBALID,STATUSSOCIAL,"
    "SQUAREPROPERTYCODE,LASTUPDATE,LASTEDITOR,SQUARETYPE,"
    "SHAPE_Area,SHAPE_Length"
)
DISTRICT_NAMES = {"003": "ATE", "010": "EL AGUSTINO"}


def iter_points(coordinates: Any) -> Iterable[tuple[float, float]]:
    if not isinstance(coordinates, list):
        return
    if (
        len(coordinates) >= 2
        and isinstance(coordinates[0], (int, float))
        and isinstance(coordinates[1], (int, float))
    ):
        yield float(coordinates[0]), float(coordinates[1])
        return
    for child in coordinates:
        yield from iter_points(child)


def polygon_rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon" and isinstance(coordinates, list):
        yield from coordinates
    elif geometry.get("type") == "MultiPolygon" and isinstance(coordinates, list):
        for polygon in coordinates:
            if isinstance(polygon, list):
                yield from polygon


def validate_feature(feature: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or properties.get("OBJECTID") is None:
        issues.append("missing_object_id")
    if not isinstance(properties, dict) or not str(properties.get("SQUARECODE") or "").strip():
        issues.append("missing_block_code")
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return [*issues, "invalid_geometry_type"]

    points = list(iter_points(geometry.get("coordinates")))
    if not points:
        issues.append("empty_geometry")
    elif any(not math.isfinite(x) or not math.isfinite(y) for x, y in points):
        issues.append("non_finite_coordinate")

    for ring in polygon_rings(geometry):
        if len(ring) < 4:
            issues.append("ring_too_short")
        if ring and ring[0][:2] != ring[-1][:2]:
            issues.append("open_ring")
    return sorted(set(issues))


def feature_bbox(feature: dict[str, Any]) -> tuple[float, float, float, float]:
    points = list(iter_points(feature["geometry"]["coordinates"]))
    if not points:
        raise ValueError("La geometria no contiene coordenadas")
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def sector_id(feature: dict[str, Any], sector_size_m: int) -> str:
    min_x, min_y, max_x, max_y = feature_bbox(feature)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    column = math.floor(center_x / sector_size_m)
    row = math.floor(center_y / sector_size_m)
    return f"E{column:04d}-N{row:04d}"


def sector_polygon(identifier: str, sector_size_m: int) -> dict[str, Any]:
    east, north = identifier.split("-")
    column = int(east[1:])
    row = int(north[1:])
    min_x = column * sector_size_m
    min_y = row * sector_size_m
    max_x = min_x + sector_size_m
    max_y = min_y + sector_size_m
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_x, min_y], [max_x, min_y], [max_x, max_y],
            [min_x, max_y], [min_x, min_y],
        ]],
    }


async def fetch_json(
    client: httpx.AsyncClient, url: str, params: dict[str, str | int]
) -> dict[str, Any]:
    response = await client.get(url, params=params)
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"ArcGIS devolvio un error: {payload['error']}")
    return payload


async def download_blocks(
    client: httpx.AsyncClient, district_code: str, output_sr: int
) -> list[dict[str, Any]]:
    url = f"{ARCGIS_SERVICE_URL}/{BLOCK_LAYER_ID}/query"
    where = f"DISTRICTCODE='{district_code}'"
    count_payload = await fetch_json(
        client, url, {"where": where, "returnCountOnly": "true", "f": "json"}
    )
    expected = int(count_payload.get("count", -1))
    if expected < 0:
        raise RuntimeError(f"No se obtuvo el conteo del distrito {district_code}")

    features: list[dict[str, Any]] = []
    offset = 0
    while offset < expected:
        payload = await fetch_json(
            client,
            url,
            {
                "where": where,
                "outFields": BLOCK_FIELDS,
                "returnGeometry": "true",
                "outSR": output_sr,
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
                "f": "geojson",
            },
        )
        page = payload.get("features") or []
        if not page:
            raise RuntimeError(
                f"Descarga incompleta {district_code}/{output_sr}: {len(features)} de {expected}"
            )
        features.extend(page)
        offset += len(page)

    object_ids = [feature.get("properties", {}).get("OBJECTID") for feature in features]
    if len(features) != expected or None in object_ids or len(set(object_ids)) != expected:
        raise RuntimeError(f"Conteo u OBJECTID inconsistente en {district_code}/{output_sr}")
    return features


def feature_collection(features: list[dict[str, Any]], srid: int) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "name": "sedapal_cadastral_blocks",
        "crs": {"type": "name", "properties": {"name": f"EPSG:{srid}"}},
        "features": features,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def prepare_outputs(
    district_code: str,
    utm_features: list[dict[str, Any]],
    wgs84_features: list[dict[str, Any]],
    output_root: Path,
    sector_size_m: int,
) -> dict[str, Any]:
    district_name = DISTRICT_NAMES.get(district_code, district_code)
    district_slug = district_name.lower().replace(" ", "-")
    district_dir = output_root / f"{district_code}-{district_slug}"

    wgs_by_id = {
        feature["properties"]["OBJECTID"]: feature for feature in wgs84_features
    }
    if set(wgs_by_id) != {
        feature["properties"]["OBJECTID"] for feature in utm_features
    }:
        raise RuntimeError(f"Las descargas UTM/WGS84 no coinciden para {district_code}")

    issues: list[dict[str, Any]] = []
    sectors_utm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sectors_wgs84: dict[str, list[dict[str, Any]]] = defaultdict(list)
    total_vertices = 0
    total_area_m2 = 0.0

    for utm_feature in utm_features:
        object_id = utm_feature["properties"]["OBJECTID"]
        identifier = sector_id(utm_feature, sector_size_m)
        wgs_feature = wgs_by_id[object_id]
        utm_feature["properties"]["scan_sector"] = identifier
        wgs_feature["properties"]["scan_sector"] = identifier
        feature_issues = validate_feature(utm_feature)
        if feature_issues:
            issues.append({
                "objectId": object_id,
                "blockCode": utm_feature["properties"].get("SQUARECODE"),
                "issues": feature_issues,
            })
        total_vertices += sum(1 for _ in iter_points(utm_feature["geometry"]["coordinates"]))
        total_area_m2 += float(utm_feature["properties"].get("SHAPE_Area") or 0)
        sectors_utm[identifier].append(utm_feature)
        sectors_wgs84[identifier].append(wgs_feature)

    write_json(district_dir / "blocks-utm32718.geojson", feature_collection(utm_features, 32718))
    write_json(district_dir / "blocks-wgs84.geojson", feature_collection(wgs84_features, 4326))

    sector_index: list[dict[str, Any]] = []
    for identifier in sorted(sectors_utm):
        write_json(
            district_dir / "sectors" / f"{identifier}-utm32718.geojson",
            feature_collection(sectors_utm[identifier], 32718),
        )
        write_json(
            district_dir / "sectors" / f"{identifier}-wgs84.geojson",
            feature_collection(sectors_wgs84[identifier], 4326),
        )
        sector_index.append({
            "type": "Feature",
            "properties": {
                "sectorId": identifier,
                "blockCount": len(sectors_utm[identifier]),
            },
            "geometry": sector_polygon(identifier, sector_size_m),
        })
    write_json(district_dir / "sector-index-utm32718.geojson", feature_collection(sector_index, 32718))

    report = {
        "districtCode": district_code,
        "districtName": district_name,
        "source": f"{ARCGIS_SERVICE_URL}/{BLOCK_LAYER_ID}",
        "sourceLayer": "Manzanas",
        "sourceSrid": 32718,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sectorSizeMeters": sector_size_m,
        "blockCount": len(utm_features),
        "sectorCount": len(sectors_utm),
        "vertexCount": total_vertices,
        "sourceAreaM2": round(total_area_m2, 3),
        "issueCount": len(issues),
        "issues": issues,
        "validationScope": [
            "OBJECTID y codigo de manzana presentes",
            "geometria Polygon o MultiPolygon no vacia",
            "coordenadas finitas",
            "anillos cerrados con al menos cuatro puntos",
            "conciliacion uno a uno entre EPSG:32718 y EPSG:4326",
        ],
        "precisionNote": (
            "Las coordenadas son vectores devueltos por Catastro Comercial SEDAPAL; "
            "no fueron inferidas desde el mapa raster. La coincidencia visual con OSM "
            "o imagen satelital requiere una fuente de control independiente."
        ),
    }
    write_json(district_dir / "scan-report.json", report)
    return report


async def run(args: argparse.Namespace) -> None:
    timeout = httpx.Timeout(90.0, connect=20.0)
    output_root = args.output_dir.resolve()
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for raw_code in args.district_codes:
            district_code = raw_code.strip().zfill(3)
            if district_code not in DISTRICT_NAMES:
                raise SystemExit(f"Distrito no habilitado para este piloto: {district_code}")
            print(f"{district_code}: descargando manzanas oficiales en EPSG:32718...")
            utm_features = await download_blocks(client, district_code, 32718)
            print(f"{district_code}: descargando copia de visualizacion en EPSG:4326...")
            wgs84_features = await download_blocks(client, district_code, 4326)
            report = prepare_outputs(
                district_code,
                utm_features,
                wgs84_features,
                output_root,
                args.sector_size_m,
            )
            print(
                f"{district_code}: {report['blockCount']} manzanas, "
                f"{report['sectorCount']} sectores, {report['issueCount']} observaciones"
            )
    print(f"Resultados: {output_root}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Escanea y sectoriza manzanas oficiales sin modificar PostGIS"
    )
    parser.add_argument(
        "--district-code",
        action="append",
        dest="district_codes",
        help="Codigo SEDAPAL; repetible. Por defecto: 003 y 010",
    )
    parser.add_argument("--sector-size-m", type=int, default=1000)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(".generated/cadastral-scans"),
    )
    args = parser.parse_args()
    args.district_codes = args.district_codes or ["003", "010"]
    if args.sector_size_m < 250 or args.sector_size_m > 5000:
        parser.error("--sector-size-m debe estar entre 250 y 5000")
    return args


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
