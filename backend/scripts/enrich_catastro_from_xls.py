import argparse
import os
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from uuid import UUID

import psycopg


@dataclass(frozen=True)
class LotAttributes:
    district_code: str
    global_id: UUID
    lot_code: str
    cup_code: str | None
    cod_mza: str | None
    property_code: str | None


def optional_text(value: str) -> str | None:
    normalized = value.strip()
    return normalized or None


class XlsHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._cell: list[str] | None = None
        self._row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.lower() == "tr":
            self._row = []
        elif tag.lower() == "td":
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "td" and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag.lower() == "tr" and self._row:
            self.rows.append(self._row)


def read_lot_attributes(path: Path, expected_district: str) -> list[LotAttributes]:
    parser = XlsHtmlParser()
    parser.feed(path.read_text(encoding="utf-8", errors="strict"))
    records: list[LotAttributes] = []
    seen: set[UUID] = set()

    for row in parser.rows:
        if len(row) < 14 or not row[0].strip().isdigit():
            continue
        district_code = row[0].strip().zfill(3)
        if district_code != expected_district:
            raise ValueError(
                f"{path.name}: distrito {district_code} distinto de {expected_district}"
            )
        global_id = UUID(row[7].strip().strip("{}"))
        if global_id in seen:
            raise ValueError(f"{path.name}: GLOBALID duplicado {global_id}")
        seen.add(global_id)
        records.append(
            LotAttributes(
                district_code=district_code,
                global_id=global_id,
                lot_code=row[2].strip(),
                cup_code=optional_text(row[9]),
                cod_mza=optional_text(row[10]),
                property_code=optional_text(row[11]),
            )
        )
    if not records:
        raise ValueError(f"{path.name}: no contiene filas de lotes reconocibles")
    return records


def enrich(directory: Path, district_codes: list[str], dry_run: bool) -> None:
    records: list[LotAttributes] = []
    for district_code in district_codes:
        path = directory / f"codigo_lotes_{district_code}.xls"
        if not path.is_file():
            raise FileNotFoundError(path)
        district_records = read_lot_attributes(path, district_code)
        records.extend(district_records)
        print(
            f"{district_code}: {len(district_records)} filas, "
            f"{sum(item.cup_code is not None for item in district_records)} CUPCODE"
        )

    database_url = os.environ["DATABASE_URL"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TEMP TABLE stage_xls_lot_attributes (
                  district_code text NOT NULL,
                  global_id uuid PRIMARY KEY,
                  lot_code text NOT NULL,
                  cup_code text,
                  cod_mza text,
                  property_code text
                ) ON COMMIT DROP
                """
            )
            with cursor.copy(
                "COPY stage_xls_lot_attributes "
                "(district_code, global_id, lot_code, cup_code, cod_mza, property_code) "
                "FROM STDIN"
            ) as copy:
                for item in records:
                    copy.write_row(
                        (
                            item.district_code,
                            item.global_id,
                            item.lot_code,
                            item.cup_code,
                            item.cod_mza,
                            item.property_code,
                        )
                    )

            cursor.execute(
                """
                SELECT count(*)
                FROM stage_xls_lot_attributes stage
                LEFT JOIN public.gis_lots lot ON lot.global_id = stage.global_id
                LEFT JOIN public.gis_districts district ON district.id = lot.district_id
                WHERE lot.id IS NULL OR district.district_code IS DISTINCT FROM stage.district_code
                """
            )
            unmatched = int(cursor.fetchone()[0])

            cursor.execute(
                """
                UPDATE public.gis_lots lot
                SET cup_code = COALESCE(stage.cup_code, lot.cup_code),
                    cod_mza = COALESCE(stage.cod_mza, lot.cod_mza),
                    property_code = COALESCE(stage.property_code, lot.property_code),
                    updated_at = now()
                FROM stage_xls_lot_attributes stage
                JOIN public.gis_districts district
                  ON district.district_code = stage.district_code
                WHERE lot.global_id = stage.global_id
                  AND lot.district_id = district.id
                """
            )
            updated = cursor.rowcount
            if unmatched:
                raise RuntimeError(f"Hay {unmatched} filas XLS sin un GLOBALID ArcGIS coincidente")
            if updated != len(records):
                raise RuntimeError(
                    f"Actualizacion incompleta: {updated} de {len(records)} registros"
                )

            if dry_run:
                connection.rollback()
                print(f"Dry-run correcto: {updated} coincidencias; transaccion revertida")
            else:
                connection.commit()
                print(f"Enriquecimiento completado: {updated} lotes actualizados")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fusiona atributos de los XLS catastrales con los lotes ArcGIS"
    )
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--district-code", action="append", dest="district_codes")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    district_codes = args.district_codes or [f"{value:03d}" for value in range(11, 21)]
    enrich(args.directory, district_codes, args.dry_run)


if __name__ == "__main__":
    main()
