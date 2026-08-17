from scripts.scan_cadastral_districts import (
    feature_bbox,
    sector_id,
    sector_polygon,
    validate_feature,
)


def block_feature() -> dict:
    return {
        "type": "Feature",
        "properties": {"OBJECTID": 7, "SQUARECODE": "M-007"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [283100.0, 8668100.0],
                [283900.0, 8668100.0],
                [283900.0, 8668900.0],
                [283100.0, 8668100.0],
            ]],
        },
    }


def test_validates_and_sectorizes_an_official_block() -> None:
    feature = block_feature()

    assert validate_feature(feature) == []
    assert feature_bbox(feature) == (283100.0, 8668100.0, 283900.0, 8668900.0)
    assert sector_id(feature, 1000) == "E0283-N8668"


def test_reports_open_and_incomplete_rings() -> None:
    feature = block_feature()
    feature["geometry"]["coordinates"] = [[[0, 0], [1, 0], [1, 1]]]

    assert validate_feature(feature) == ["open_ring", "ring_too_short"]


def test_builds_a_metric_sector_polygon() -> None:
    polygon = sector_polygon("E0283-N8668", 1000)

    assert polygon["coordinates"][0] == [
        [283000, 8668000],
        [284000, 8668000],
        [284000, 8669000],
        [283000, 8669000],
        [283000, 8668000],
    ]
