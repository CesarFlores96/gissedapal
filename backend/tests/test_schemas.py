import pytest

from app.schemas import parse_bbox, parse_layers


def test_parse_bbox_accepts_lima_bounds() -> None:
    bbox = parse_bbox("-77.2,-12.3,-76.8,-11.8")
    assert bbox.as_params() == [-77.2, -12.3, -76.8, -11.8]


@pytest.mark.parametrize("value", ["-77,-12,-78,-11", "-77,-12,-76", "texto"])
def test_parse_bbox_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ValueError):
        parse_bbox(value)


def test_parse_layers_deduplicates_and_validates() -> None:
    assert parse_layers("suministros,medidores,suministros") == ["suministros", "medidores"]
    with pytest.raises(ValueError, match="no admitidas"):
        parse_layers("suministros,falsa")

