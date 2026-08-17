from pathlib import Path


MIGRATIONS = Path(__file__).parents[1] / "migrations"


def test_lot_mvt_applies_block_and_lot_corrections() -> None:
    sql = (MIGRATIONS / "014_apply_cadastral_corrections_to_lot_mvt.up.sql").read_text(
        encoding="utf-8"
    )

    assert "block_correction.block_id = l.block_id" in sql
    assert "lot_correction.lot_id = l.id" in sql
    assert (
        "COALESCE(block_correction.delta_lng, 0) + "
        "COALESCE(lot_correction.delta_lng, 0)"
    ) in sql
    assert (
        "COALESCE(block_correction.delta_lat, 0) + "
        "COALESCE(lot_correction.delta_lat, 0)"
    ) in sql
    assert "ST_AsMVT(features, 'lots', 4096, 'geom')" in sql


def test_lot_mvt_rollback_restores_previous_function() -> None:
    previous = (MIGRATIONS / "009_enrich_lot_mvt.up.sql").read_text(encoding="utf-8")
    rollback = (MIGRATIONS / "014_apply_cadastral_corrections_to_lot_mvt.down.sql").read_text(
        encoding="utf-8"
    )

    assert rollback == previous
