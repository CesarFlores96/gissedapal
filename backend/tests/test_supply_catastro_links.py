import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "import_supply_catastro_links.py"
SPEC = importlib.util.spec_from_file_location("import_supply_catastro_links", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_normalize_header_preserves_business_key_names() -> None:
    assert MODULE.normalize_header("CODIGO DE LOTE") == "codigo_de_lote"
    assert MODULE.normalize_header("*CUA") == "cua"
    assert MODULE.normalize_header("N° MUNICIPAL ENVIO") == "n_municipal_envio"


def test_resolve_cua_uses_tariff_only_to_break_a_tie() -> None:
    catalog = [
        (1, "0202", "PREDIO DESHABITADO"),
        (2, "0302", "PREDIO DESHABITADO"),
        (3, "0565", "PARQUES, JARDINES, BERMAS Y PILETA"),
    ]

    assert MODULE.resolve_cua("PREDIO DESHABITADO", "Comercial", catalog) == (2, "EXACT")
    assert MODULE.resolve_cua("PARQUES, JARDINES, BERMAS Y PILETA", "Comercial", catalog) == (
        3,
        "EXACT",
    )


def test_resolve_cua_does_not_force_an_ambiguous_match() -> None:
    catalog = [
        (1, "0301", "FABRICA DE MUEBLES Y ACCES"),
        (2, "0302", "FABRICA DE MUEBLES Y ACCESORIO"),
    ]

    assert MODULE.resolve_cua("FABRICA DE MUEBLES Y ACCESORIOS", "Comercial", catalog) == (
        None,
        "UNRESOLVED",
    )
