from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
import httpx

from app.auth import CurrentUser
from app.database import get_pool
from app.repositories.gis import (
    fetch_district_catalog,
    fetch_layers,
    fetch_supply_consumption,
    fetch_supply_detail,
    resolve_location,
    save_geometry_correction,
    search_cadastre,
    fetch_lot_context,
)
from app.schemas import GeometryCorrectionRequest, parse_bbox, parse_layers

router = APIRouter(prefix="/gis", tags=["gis"])


@router.get("/distritos")
async def district_catalog(_user: CurrentUser) -> dict:
    return {"districts": await fetch_district_catalog(get_pool())}


@router.get("/catastro/buscar")
async def cadastral_search(
    _user: CurrentUser,
    query: str = Query(..., min_length=2, max_length=40),
    kind: str = Query(default="all", pattern="^(all|block|lot)$"),
    limit: int = Query(default=12, ge=1, le=30),
) -> dict:
    return {"results": await search_cadastre(get_pool(), query, kind, limit)}


@router.post("/catastro/ajuste")
async def adjust_cadastral_geometry(body: GeometryCorrectionRequest, user: CurrentUser) -> dict:
    result = await save_geometry_correction(
        get_pool(),
        body.targetKind,
        str(body.targetId),
        body.deltaLng,
        body.deltaLat,
        str(user.get("sub")) if user.get("sub") else None,
        body.reset,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="La geometría catastral no existe.")
    return result


@router.get("/capas")
async def layers(
    _user: CurrentUser,
    bbox: str = Query(..., description="minx,miny,maxx,maxy en EPSG:4326"),
    layers: str = Query(default="distritos,suministros,medidores"),
    district: str | None = Query(default=None, min_length=1, max_length=120),
    zoom: float = Query(default=10, ge=0, le=24),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=500, ge=1, le=2000),
) -> dict:
    try:
        parsed_bbox = parse_bbox(bbox)
        parsed_layers = parse_layers(layers)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await fetch_layers(
        get_pool(), parsed_bbox, parsed_layers, page, page_size, district=district, zoom=zoom
    )


@router.get("/suministro/{supply_code}")
async def supply_detail(supply_code: str, _user: CurrentUser) -> dict:
    row = await fetch_supply_detail(get_pool(), supply_code.strip())
    if not row:
        raise HTTPException(status_code=404, detail="Suministro no encontrado.")
    geometry = row.get("geometry")
    if not geometry:
        raw_lng = row.get("longitude")
        raw_lat = row.get("latitude")
        try:
            lng = float(raw_lng) if raw_lng is not None else None
            lat = float(raw_lat) if raw_lat is not None else None
        except (TypeError, ValueError):
            lng = None
            lat = None
        if lng is not None and lat is not None:
            geometry = {"type": "Point", "coordinates": [lng, lat]}
    geometry_available = bool(
        isinstance(geometry, dict)
        and geometry.get("type") == "Point"
        and isinstance(geometry.get("coordinates"), list)
        and len(geometry["coordinates"]) >= 2
    )
    return {
        "supply": {
            "id": row["id"],
            "code": row["supply_code"],
            "customerName": row.get("customer_name"),
            "address": row.get("service_address"),
            "status": row.get("supply_status"),
            "locationSource": row.get("location_source"),
            "locationQuality": row.get("location_quality"),
        },
        "geometry": geometry,
        "meter": ({
            "code": row.get("meter_code"),
            "diameter": row.get("meter_diameter"),
            "installationDate": row.get("installation_date"),
            "status": row.get("meter_status"),
        } if row.get("meter_code") else None),
        "hierarchy": {
            "district": row.get("structured_district_name") or row.get("district") or row.get("district_text"),
            "quadrant": row.get("sector"),
            "lot": row.get("structured_cup_code") or row.get("lot_code"),
            "provisional": not geometry_available,
            "geometryAvailable": geometry_available,
        },
        "cadastre": (
            {
                "districtCode": row.get("structured_district_code"),
                "districtName": row.get("structured_district_name"),
                "districtMatchStatus": row.get("district_match_status"),
                "blockCode": row.get("structured_block_code"),
                "cupCode": row.get("structured_cup_code"),
                "geometryMatchStatus": row.get("geometry_match_status"),
                "geometryCount": row.get("gis_lot_match_count") or 0,
                "cuaCode": row.get("cua_code"),
                "cuaLabel": row.get("cua_label"),
                "cuaCatalogDescription": row.get("cua_catalog_description"),
                "cuaMatchMethod": row.get("cua_match_method"),
            }
            if row.get("structured_district_code") or row.get("structured_cup_code") or row.get("cua_label")
            else None
        ),
        # Referencia catastral resuelta espacialmente (gis_lots), distinta del
        # lot_code textual de facturación en "hierarchy.lot": permite saltar al
        # lote real en el mapa.
        "cadastralLink": (
            {
                "kind": "lot",
                "recordId": row["resolved_lot_id"],
                "code": row.get("resolved_lot_code"),
                "blockCode": row.get("resolved_block_code"),
                "method": row.get("resolved_lot_method"),
            }
            if row.get("resolved_lot_id")
            else None
        ),
        "consumption": None,
        "consumptionLoading": True,
    }


@router.get("/suministro/{supply_code}/consumo")
async def supply_consumption(supply_code: str, _user: CurrentUser) -> dict | None:
    row = await fetch_supply_consumption(get_pool(), supply_code.strip())
    if row is None:
        raise HTTPException(status_code=404, detail="Suministro no encontrado.")
    return _build_consumption(row)


def _build_consumption(row: dict) -> dict | None:
    """Promedio de consumo (m3) del año en curso y su comparación distrital.

    Ambos promedios dependen de customer_supply_billing_daily, que puede no
    tener aún filas cargadas para el período — en ese caso se devuelve None en
    los campos correspondientes en vez de un cero engañoso.
    """
    supply_avg = row.get("supply_avg_m3")
    district_avg = row.get("district_avg_m3")
    if supply_avg is None and district_avg is None:
        return None
    comparison_percent = None
    if supply_avg is not None and district_avg is not None and district_avg > 0:
        comparison_percent = ((supply_avg - district_avg) / district_avg) * 100
    return {
        "currentYearAverageM3": supply_avg,
        "readingCount": row.get("supply_reading_count") or 0,
        "districtAverageM3": district_avg,
        "districtSupplyCount": row.get("district_supply_count") or 0,
        "comparisonPercent": comparison_percent,
    }


@router.get("/relacion")
async def relationship(
    _user: CurrentUser,
    lng: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    tolerance_m: float = Query(default=25, gt=0, le=500),
) -> dict:
    return await resolve_location(get_pool(), lng, lat, tolerance_m)


http_client = httpx.AsyncClient()


@router.get("/lote/{lot_id}")
async def get_lot_context_endpoint(lot_id: str, _user: CurrentUser) -> dict:
    result = await fetch_lot_context(get_pool(), lot_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Lote no encontrado.")
    return result


@router.get("/tiles/{path:path}")
async def proxy_tile_server(path: str, request: Request, _user: CurrentUser):
    # Martin se ejecuta localmente en el puerto 3000 en el servidor
    martin_url = f"http://127.0.0.1:3000/{path}"
    query_params = request.query_params
    
    try:
        req = http_client.build_request(
            method="GET",
            url=martin_url,
            params=query_params,
            headers={"accept-encoding": request.headers.get("accept-encoding", "")}
        )
        resp = await http_client.send(req, stream=True)
        
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="MVT Tile no encontrada")
        elif resp.status_code != 200:
            await resp.aread()
            raise HTTPException(status_code=resp.status_code, detail="Error del servidor de tiles")
            
        return StreamingResponse(
            resp.aiter_bytes(),
            status_code=resp.status_code,
            headers=dict(resp.headers),
            media_type=resp.headers.get("content-type", "application/x-protobuf")
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Error conectando al servidor de tiles local: {str(exc)}")
