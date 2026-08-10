from typing import Any

import httpx
import pytest

from scripts.import_sedapal_catastro import (
    BLOCKS,
    download_layer,
    normalize_guid,
    require_geometry,
)


class ArcGISTransport(httpx.AsyncBaseTransport):
    def __init__(self, pages: dict[int, list[dict[str, Any]]], total: int) -> None:
        self.pages = pages
        self.total = total

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        query = request.url.params
        if query.get("returnCountOnly") == "true":
            return httpx.Response(200, json={"count": self.total})
        offset = int(query.get("resultOffset", "0"))
        return httpx.Response(
            200,
            json={"type": "FeatureCollection", "features": self.pages.get(offset, [])},
        )


def feature(object_id: int) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": {"OBJECTID": object_id},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[-77.0, -12.0], [-77.0, -12.1], [-76.9, -12.0], [-77.0, -12.0]]],
        },
    }


@pytest.mark.asyncio
async def test_download_layer_rejects_an_incomplete_page() -> None:
    transport = ArcGISTransport({0: [feature(1)]}, total=2)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(RuntimeError, match="Descarga incompleta"):
            await download_layer(client, BLOCKS, "010")


@pytest.mark.asyncio
async def test_download_layer_rejects_duplicate_object_ids() -> None:
    transport = ArcGISTransport({0: [feature(1), feature(1)]}, total=2)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(RuntimeError, match="OBJECTID duplicado"):
            await download_layer(client, BLOCKS, "010")


def test_geometry_and_global_id_validation() -> None:
    assert normalize_guid("{96B8EA06-C81F-4A81-8446-E45B46582774}") == (
        "96b8ea06-c81f-4a81-8446-e45b46582774"
    )
    assert require_geometry(feature(1), "manzanas")["type"] == "Polygon"
    with pytest.raises(ValueError, match="GLOBALID invalido"):
        normalize_guid("invalido")
    with pytest.raises(ValueError, match="geometria"):
        require_geometry({"geometry": None}, "lotes")
