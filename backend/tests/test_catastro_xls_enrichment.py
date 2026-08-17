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


def test_reads_exported_html_xls_filters_districts_and_deduplicates(tmp_path: Path) -> None:
    path = tmp_path / "codigo_lotes_036_mixed.xls"
    path.write_text(
        """
        <table>
          <tr>
            <td>007</td><td>0001</td><td>LOT-007</td><td>LOC</td><td>2</td>
            <td>TL001</td><td>ACTIVO</td>
            <td>{00000000-0000-0000-0000-000000000007}</td><td>SAP</td>
            <td>00700010001</td><td>0070001</td><td>P-007</td><td></td><td></td>
          </tr>
          <tr>
            <td>036</td><td>90311</td><td>632879</td><td></td><td>0</td>
            <td>TL001</td><td></td>
            <td>{72286FF6-8222-4ACB-A9A3-1F2C2FE470BE}</td><td></td>
            <td>036054150060</td><td>03605415</td><td></td><td></td><td></td>
          </tr>
          <tr>
            <td>036</td><td>90311</td><td>632879</td><td></td><td>0</td>
            <td>TL001</td><td></td>
            <td>{72286FF6-8222-4ACB-A9A3-1F2C2FE470BE}</td><td></td>
            <td>036054150060</td><td>03605415</td><td></td><td></td><td></td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    records = read_lot_attributes(path, "036")

    assert len(records) == 1
    assert records[0].district_code == "036"
    assert records[0].lot_code == "632879"
    assert str(records[0].global_id).lower() == "72286ff6-8222-4acb-a9a3-1f2c2fe470be"
