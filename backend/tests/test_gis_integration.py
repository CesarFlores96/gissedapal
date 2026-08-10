import os

import pytest

from app.database import close_pool, get_pool, open_pool
from app.repositories.gis import (
    fetch_layers,
    fetch_supply_detail,
    resolve_location,
    save_geometry_correction,
    search_cadastre,
)
from app.repositories.shared import fetch_one
from app.routers.gis import supply_detail as supply_detail_response
from app.schemas import BBox

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_GIS_INTEGRATION") != "1",
    reason="Requiere la base PostGIS local migrada.",
)


@pytest.mark.asyncio
async def test_current_lima_data_and_relationship_contract() -> None:
    await open_pool()
    try:
        pool = get_pool()
        bbox = BBox(minx=-77.3, miny=-12.5, maxx=-76.7, maxy=-11.7)
        result = await fetch_layers(
            pool,
            bbox,
            ["distritos", "manzanas", "cuadrantes", "lotes", "tuberias", "alcantarillado", "suministros"],
            page=1,
            page_size=100,
        )
        assert result["layers"]["distritos"]["meta"]["total"] == 50
        district_features = result["layers"]["distritos"]["data"]["features"]
        assert all("supply_count" in feature["properties"] for feature in district_features)
        assert sum(feature["properties"]["supply_count"] for feature in district_features) > 16_000
        assert result["layers"]["suministros"]["meta"]["total"] > 16_000
        for zoom_limited_layer in ("manzanas", "lotes"):
            assert result["layers"][zoom_limited_layer]["meta"]["available"] is True
            assert result["layers"][zoom_limited_layer]["meta"]["zoomLimited"] is True
            assert result["layers"][zoom_limited_layer]["data"]["features"] == []
        for empty_layer in ("cuadrantes", "tuberias", "alcantarillado"):
            assert result["layers"][empty_layer]["meta"]["available"] is False
            assert result["layers"][empty_layer]["data"]["features"] == []

        sample = await fetch_one(
            pool,
            """
            SELECT cs.supply_code, cs.longitude, cs.latitude
            FROM public.customer_supplies cs
            JOIN public.gis_supply_locations sl ON sl.supply_id = cs.id
            WHERE cs.meter_code IS NOT NULL
            LIMIT 1
            """,
        )
        assert sample is not None
        detail = await fetch_supply_detail(pool, sample["supply_code"])
        assert detail is not None and detail["meter_code"]
        assert await fetch_supply_detail(pool, "__NIS_INEXISTENTE__") is None

        structured = await fetch_supply_detail(pool, "4000091")
        assert structured is not None
        assert structured["structured_district_code"] == "010"
        assert structured["structured_block_code"] == "01001145"
        assert structured["structured_cup_code"] == "010011450130"
        assert structured["cua_code"] == "0551"
        assert structured["resolved_lot_method"] == "CUPCODE"
        structured_response = await supply_detail_response("4000091", {})
        assert structured_response["cadastre"] == {
            "districtCode": "010",
            "districtName": "EL AGUSTINO",
            "districtMatchStatus": "MATCHED",
            "blockCode": "01001145",
            "cupCode": "010011450130",
            "geometryMatchStatus": "UNIQUE_GEOMETRY",
            "geometryCount": 1,
            "cuaCode": "0551",
            "cuaLabel": "COLEGIO  ESTATAL",
            "cuaCatalogDescription": "COLEGIO ESTATAL",
            "cuaMatchMethod": "EXACT",
        }
        assert structured_response["cadastralLink"]["method"] == "CUPCODE"
        structured_search = await search_cadastre(pool, "010011450130", "lot", 12)
        assert any(result["code"] == "1400093" for result in structured_search)

        lng = float(sample["longitude"])
        lat = float(sample["latitude"])
        nearby = await fetch_layers(
            pool,
            BBox(minx=lng - 0.001, miny=lat - 0.001, maxx=lng + 0.001, maxy=lat + 0.001),
            ["suministros"],
            page=1,
            page_size=100,
        )
        assert nearby["layers"]["suministros"]["meta"]["total"] >= 1
        district_filtered = await fetch_layers(
            pool,
            bbox,
            ["suministros"],
            page=1,
            page_size=100,
            district=detail["district"],
        )
        assert district_filtered["layers"]["suministros"]["meta"]["total"] > 0
        outside = await fetch_layers(
            pool,
            BBox(minx=-80, miny=-15, maxx=-79, maxy=-14),
            ["suministros"],
            page=1,
            page_size=100,
        )
        assert outside["layers"]["suministros"]["meta"]["total"] == 0

        relationship = await resolve_location(
            pool, lng, lat, 25
        )
        assert relationship["supply"]["supplyCode"] == sample["supply_code"]

        lot_point = await fetch_one(
            pool,
            """
            SELECT ST_X(ST_PointOnSurface(l.geom)) AS lng,
                   ST_Y(ST_PointOnSurface(l.geom)) AS lat,
                   d.name AS district_name
            FROM public.gis_lots l
            JOIN public.gis_districts d ON d.id = l.district_id
            WHERE l.source = 'SEDAPAL_ARCGIS_CATASTRO_COMERCIAL'
            LIMIT 1
            """,
        )
        assert lot_point is not None
        cadastral = await resolve_location(
            pool, float(lot_point["lng"]), float(lot_point["lat"]), 25
        )
        assert cadastral["district"]["name"] == lot_point["district_name"]
        assert cadastral["block"]["blockCode"]
        assert cadastral["lot"]["lotCode"]

        lot_results = await search_cadastre(pool, cadastral["lot"]["lotCode"], "all", 12)
        assert lot_results[0]["kind"] == "lot"
        assert lot_results[0]["properties"]["area_m2"] > 0
        assert lot_results[0]["properties"]["display_code"] == cadastral["lot"]["lotCode"][-4:]
        block_results = await search_cadastre(pool, cadastral["block"]["blockCode"], "block", 12)
        assert block_results[0]["kind"] == "block"
        assert block_results[0]["properties"]["lot_count"] > 0

        movable_lot = await fetch_one(
            pool,
            """
                SELECT l.lot_code, b.block_code
                FROM public.gis_lots l
                JOIN public.gis_blocks b ON b.id = l.block_id
                JOIN public.gis_districts d ON d.id = l.district_id
                WHERE d.district_code = '010'
                  AND ST_CoveredBy(ST_Translate(l.geom, 0.00001, -0.00001), b.geom)
                LIMIT 1
            """,
        )
        assert movable_lot is not None
        selected = (await search_cadastre(pool, movable_lot["lot_code"], "lot", 1))[0]
        block_results = await search_cadastre(pool, movable_lot["block_code"], "block", 1)
        original_center = selected["center"]
        try:
            correction = await save_geometry_correction(
                pool, "lot", selected["id"], 0.00001, -0.00001, "integration-test", False
            )
            assert correction and correction["deltaLng"] == pytest.approx(0.00001)
            moved = (await search_cadastre(pool, selected["code"], "lot", 1))[0]
            assert moved["center"][0] == pytest.approx(original_center[0] + 0.00001)
            assert moved["center"][1] == pytest.approx(original_center[1] - 0.00001)
            moved_relation = await resolve_location(
                pool, float(moved["center"][0]), float(moved["center"][1]), 25
            )
            assert moved_relation["lot"]["lotCode"] == selected["code"]
        finally:
            await save_geometry_correction(
                pool, "lot", selected["id"], 0, 0, "integration-test", True
            )

        restored_lot = (await search_cadastre(pool, selected["code"], "lot", 1))[0]
        try:
            block_correction = await save_geometry_correction(
                pool, "block", block_results[0]["id"], -0.00001, 0.00001, "integration-test", False
            )
            assert block_correction is not None
            assert abs(float(block_correction["deltaLng"])) <= 0.00001
            assert abs(float(block_correction["deltaLat"])) <= 0.00001
            child_after_block_move = (await search_cadastre(pool, selected["code"], "lot", 1))[0]
            assert child_after_block_move["center"][0] == pytest.approx(
                restored_lot["center"][0] + float(block_correction["deltaLng"])
            )
            assert child_after_block_move["center"][1] == pytest.approx(
                restored_lot["center"][1] + float(block_correction["deltaLat"])
            )
        finally:
            await save_geometry_correction(
                pool, "block", block_results[0]["id"], 0, 0, "integration-test", True
            )

        try:
            bounded_lot = await save_geometry_correction(
                pool, "lot", selected["id"], 0.001, 0.001, "integration-test", False
            )
            assert bounded_lot and bounded_lot["limited"] is True
            within_block = await fetch_one(
                pool,
                """
                SELECT ST_CoveredBy(
                  ST_Translate(l.geom, c.delta_lng, c.delta_lat), b.geom
                ) AS valid
                FROM public.gis_lots l
                JOIN public.gis_blocks b ON b.id = l.block_id
                JOIN public.gis_geometry_corrections c ON c.lot_id = l.id
                WHERE l.id = %s::uuid
                """,
                [selected["id"]],
            )
            assert within_block and within_block["valid"] is True
        finally:
            await save_geometry_correction(
                pool, "lot", selected["id"], 0, 0, "integration-test", True
            )

        try:
            bounded_block = await save_geometry_correction(
                pool, "block", block_results[0]["id"], 0.001, 0.001, "integration-test", False
            )
            assert bounded_block and bounded_block["limited"] is True
            distance = await fetch_one(
                pool,
                """
                SELECT ST_Distance(
                  ST_PointOnSurface(b.geom)::geography,
                  ST_PointOnSurface(ST_Translate(b.geom, c.delta_lng, c.delta_lat))::geography
                ) AS meters
                FROM public.gis_blocks b
                JOIN public.gis_geometry_corrections c ON c.block_id = b.id
                WHERE b.id = %s::uuid
                """,
                [block_results[0]["id"]],
            )
            assert distance and float(distance["meters"]) <= 15.01
        finally:
            await save_geometry_correction(
                pool, "block", block_results[0]["id"], 0, 0, "integration-test", True
            )
    finally:
        await close_pool()
