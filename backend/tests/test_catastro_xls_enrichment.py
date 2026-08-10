from pathlib import Path

from scripts.enrich_catastro_from_xls import read_lot_attributes


def test_reads_exported_html_xls_by_stable_column_order(tmp_path: Path) -> None:
    path = tmp_path / "codigo_lotes_011.xls"
    path.write_text(
        """
        <table><tr>
          <td>011</td><td>0001</td><td>LOT-1</td><td>LOC</td><td>2</td>
          <td>TL003</td><td>ACTIVO</td>
          <td>{11111111-1111-1111-1111-111111111111}</td><td>SAP</td>
          <td>01100010001</td><td>0110001</td><td>P-1</td><td></td><td></td>
        </tr></table>
        """,
        encoding="utf-8",
    )

    records = read_lot_attributes(path, "011")

    assert len(records) == 1
    assert records[0].lot_code == "LOT-1"
    assert records[0].cup_code == "01100010001"
    assert records[0].cod_mza == "0110001"
    assert records[0].property_code == "P-1"
