import argparse
import html
import os
import re
from dataclasses import dataclass
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


@dataclass(frozen=True)
class BlockAttributes:
    district_code: str
    global_id: UUID
    block_code: str
    socioeconomic_level: str | None
    property_code: str | None
    block_type_code: str | None


def optional_text(value: str) -> str | None:
    normalized = value.strip()
    return normalized or None


ROW_PATTERN = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_PATTERN = re.compile(
    r"<t[dh]\b[^>]*>(.*?)(?=<t[dh]\b[^>]*>|$)",
    re.IGNORECASE | re.DOTALL,
)
TAG_PATTERN = re.compile(r"<[^>]+>")


def read_html_rows(path: Path) -> list[list[str]]:
    """Lee exports HTML .xls que omiten cierres </td> para celdas vacías."""
    content = path.read_text(encoding="utf-8", errors="strict")
    rows: list[list[str]] = []
    for raw_row in ROW_PATTERN.findall(content):
        cells = [
            " ".join(html.unescape(TAG_PATTERN.sub("", raw_cell)).split())
            for raw_cell in CELL_PATTERN.findall(raw_row)
        ]
        if cells:
            rows.append(cells)
    return rows


def read_lot_attributes(path: Path, expected_district: str) -> list[LotAttributes]:
    records: list[LotAttributes] = []
    seen: set[UUID] = set()

    for row in read_html_rows(path):
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


def read_block_attributes(path: Path, expected_district: str) -> list[BlockAttributes]:
    records: list[BlockAttributes] = []
    seen: set[UUID] = set()

    for row in read_html_rows(path):
        if len(row) < 8 or not row[0].strip().isdigit():
            continue
        district_code = row[0].strip().zfill(3)
        if district_code != expected_district:
            raise ValueError(
                f"{path.name}: distrito {district_code} distinto de {expected_district}"
            )
        global_id = UUID(row[2].strip().strip("{}"))
        if global_id in seen:
            raise ValueError(f"{path.name}: GLOBALID duplicado {global_id}")
        seen.add(global_id)
        records.append(
            BlockAttributes(
                district_code=district_code,
                global_id=global_id,
                block_code=row[1].strip(),
                socioeconomic_level=optional_text(row[3]),
                property_code=optional_text(row[4]),
                block_type_code=optional_text(row[7]),
            )
        )
    if not records:
        raise ValueError(f"{path.name}: no contiene filas de manzanas reconocibles")
    return records


def find_export(directory: Path, district_code: str, prefixes: tuple[str, ...]) -> Path:
    for prefix in prefixes:
        path = directory / f"{prefix}_{district_code}.xls"
        if path.is_file():
            return path
    expected = ", ".join(f"{prefix}_{district_code}.xls" for prefix in prefixes)
    raise FileNotFoundError(f"No se encontró ninguno de: {expected}")


def enrich(
    directory: Path,
    district_codes: list[str],
    dry_run: bool,
    lot_paths: list[Path] | None = None,
    block_paths: list[Path] | None = None,
) -> None:
    lot_records: list[LotAttributes] = []
    block_records: list[BlockAttributes] = []
    if lot_paths is not None or block_paths is not None:
        if not lot_paths or not block_paths:
            raise ValueError("Se requiere al menos un XLS de lotes y uno de manzanas")
        for lot_path in lot_paths:
            rows = read_html_rows(lot_path)
            district_code = next(
                (row[0].strip().zfill(3) for row in rows if row and row[0].strip().isdigit()),
                None,
            )
            if district_code is None:
                raise ValueError(f"{lot_path.name}: no contiene distrito reconocible")
            district_lots = read_lot_attributes(lot_path, district_code)
            lot_records.extend(district_lots)
            print(f"{district_code}: {len(district_lots)} lotes, {sum(item.cup_code is not None for item in district_lots)} CUPCODE")
        for block_path in block_paths:
            rows = read_html_rows(block_path)
            district_code = next(
                (row[0].strip().zfill(3) for row in rows if row and row[0].strip().isdigit()),
                None,
            )
            if district_code is None:
                raise ValueError(f"{block_path.name}: no contiene distrito reconocible")
            district_blocks = read_block_attributes(block_path, district_code)
            block_records.extend(district_blocks)
            print(f"{district_code}: {len(district_blocks)} manzanas")
    else:
        for district_code in district_codes:
            lot_path = find_export(directory, district_code, ("codigo_lotes", "codigo_distritro"))
            block_path = find_export(directory, district_code, ("codigo_manzana",))
            district_lots = read_lot_attributes(lot_path, district_code)
            district_blocks = read_block_attributes(block_path, district_code)
            lot_records.extend(district_lots)
            block_records.extend(district_blocks)
            print(
                f"{district_code}: {len(district_blocks)} manzanas, {len(district_lots)} lotes, "
                f"{sum(item.cup_code is not None for item in district_lots)} CUPCODE"
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
                ) ON COMMIT DROP;
                CREATE TEMP TABLE stage_xls_block_attributes (
                  district_code text NOT NULL,
                  global_id uuid PRIMARY KEY,
                  block_code text NOT NULL,
                  socioeconomic_level text,
                  property_code text,
                  block_type_code text
                ) ON COMMIT DROP
                """
            )
            with cursor.copy(
                "COPY stage_xls_lot_attributes "
                "(district_code, global_id, lot_code, cup_code, cod_mza, property_code) "
                "FROM STDIN"
            ) as copy:
                for item in lot_records:
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

            with cursor.copy(
                "COPY stage_xls_block_attributes "
                "(district_code, global_id, block_code, socioeconomic_level, property_code, block_type_code) "
                "FROM STDIN"
            ) as copy:
                for item in block_records:
                    copy.write_row(
                        (
                            item.district_code,
                            item.global_id,
                            item.block_code,
                            item.socioeconomic_level,
                            item.property_code,
                            item.block_type_code,
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
                SELECT count(*)
                FROM stage_xls_block_attributes stage
                LEFT JOIN public.gis_blocks block ON block.global_id = stage.global_id
                LEFT JOIN public.gis_districts district ON district.id = block.district_id
                WHERE block.id IS NULL OR district.district_code IS DISTINCT FROM stage.district_code
                """
            )
            unmatched_blocks = int(cursor.fetchone()[0])

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
            cursor.execute(
                """
                UPDATE public.gis_blocks block
                SET property_code = COALESCE(stage.property_code, block.property_code),
                    block_type_code = COALESCE(stage.block_type_code, block.block_type_code),
                    properties = CASE
                      WHEN stage.socioeconomic_level IS NULL THEN block.properties
                      ELSE block.properties || jsonb_build_object(
                        'xls_socioeconomic_level', stage.socioeconomic_level
                      )
                    END,
                    updated_at = now()
                FROM stage_xls_block_attributes stage
                JOIN public.gis_districts district
                  ON district.district_code = stage.district_code
                WHERE block.global_id = stage.global_id
                  AND block.district_id = district.id
                """
            )
            updated_blocks = cursor.rowcount
            if unmatched or unmatched_blocks:
                raise RuntimeError(
                    "Hay filas XLS sin un GLOBALID ArcGIS coincidente: "
                    f"{unmatched} lotes, {unmatched_blocks} manzanas"
                )
            if updated != len(lot_records) or updated_blocks != len(block_records):
                raise RuntimeError(
                    "Actualizacion incompleta: "
                    f"{updated} de {len(lot_records)} lotes, "
                    f"{updated_blocks} de {len(block_records)} manzanas"
                )

            if dry_run:
                connection.rollback()
                print(
                    "Dry-run correcto: "
                    f"{updated} lotes y {updated_blocks} manzanas; transaccion revertida"
                )
            else:
                connection.commit()
                print(
                    "Enriquecimiento completado: "
                    f"{updated} lotes y {updated_blocks} manzanas actualizados"
                )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fusiona atributos de los XLS catastrales con los lotes ArcGIS"
    )
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--district-code", action="append", dest="district_codes")
    parser.add_argument("--lots-file", type=Path, action="append", dest="lot_paths")
    parser.add_argument("--blocks-file", type=Path, action="append", dest="block_paths")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    district_codes = args.district_codes or [f"{value:03d}" for value in range(11, 21)]
    enrich(args.directory, district_codes, args.dry_run, args.lot_paths, args.block_paths)


if __name__ == "__main__":
    main()
