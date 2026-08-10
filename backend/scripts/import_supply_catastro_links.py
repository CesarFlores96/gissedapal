from __future__ import annotations

import argparse
import os
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from xml.etree.ElementTree import iterparse
from zipfile import ZipFile

import psycopg


SHEET_XML = "xl/worksheets/sheet1.xml"
XML_NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MONTH_ORDER = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}
TARIFF_CUA_PREFIX = {
    "social": "01",
    "domestico": "02",
    "multifamiliar": "02",
    "comercial": "03",
    "industrial": "04",
    "estatal": "05",
}


@dataclass(frozen=True)
class ImportRecord:
    supply_code: str
    cup_code: str | None
    source_district_code: str | None
    source_district_name: str | None
    tariff: str | None
    cua_label: str | None
    sec_cta: str | None
    scheme_code: str | None
    shipping_street: str | None
    shipping_municipal_number: str | None
    shipping_duplicator: str | None
    shipping_locality: str | None
    shipping_reference: str | None
    shipping_district_code: str | None
    shipping_district_name: str | None
    shipping_zone_name: str | None
    score: tuple[int, int, int]


def normalize_header(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def normalize_text(value: object) -> str | None:
    text = str(value or "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text or None


def normalize_catalog_label(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or "").upper())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return " ".join(re.findall(r"[A-Z0-9]+", text))


def cell_value(cell: object) -> str:
    text_node = cell.find(f".//{XML_NAMESPACE}t")
    if text_node is not None:
        return text_node.text or ""
    value_node = cell.find(f"{XML_NAMESPACE}v")
    return "" if value_node is None else (value_node.text or "")


def worksheet_rows(path: Path) -> Iterator[list[str]]:
    with ZipFile(path) as workbook, workbook.open(SHEET_XML) as sheet:
        for _, element in iterparse(sheet, events=("end",)):
            if element.tag != f"{XML_NAMESPACE}row":
                continue
            yield [cell_value(cell) for cell in element.findall(f"{XML_NAMESPACE}c")]
            element.clear()


def read_latest_records(path: Path) -> dict[str, ImportRecord]:
    rows = worksheet_rows(path)
    headers = [normalize_header(value) for value in next(rows)]
    header_count = len(headers)
    latest: dict[str, ImportRecord] = {}
    completeness_fields = (
        "correo",
        "celular",
        "telefono_fijo",
        "persona_de_contacto",
        "medidor",
        "fecha_instalacion",
        "documento",
        "calle",
        "referencia",
    )

    for values in rows:
        values.extend([""] * (header_count - len(values)))
        row = dict(zip(headers, values, strict=True))
        supply_code = normalize_text(row.get("nis_hijo"))
        if supply_code is None:
            continue
        year_text = normalize_text(row.get("periodo_ano")) or "0"
        year = int(float(year_text))
        month = MONTH_ORDER.get((normalize_text(row.get("periodo_mes")) or "").lower(), 0)
        completeness = sum(normalize_text(row.get(field)) is not None for field in completeness_fields)
        district_code = normalize_text(row.get("codigo_distrito"))
        shipping_district_code = normalize_text(row.get("codigo_distrito_envio"))
        record = ImportRecord(
            supply_code=supply_code,
            cup_code=normalize_text(row.get("codigo_de_lote")),
            source_district_code=district_code.zfill(3) if district_code else None,
            source_district_name=normalize_text(row.get("distrito")),
            tariff=normalize_text(row.get("tarifa")),
            cua_label=normalize_text(row.get("cua")),
            sec_cta=normalize_text(row.get("sec_cta")),
            scheme_code=normalize_text(row.get("esquema")),
            shipping_street=normalize_text(row.get("calle_de_envio")),
            shipping_municipal_number=normalize_text(row.get("n_municipal_envio")),
            shipping_duplicator=normalize_text(row.get("duplicador_envio")),
            shipping_locality=normalize_text(row.get("localidad_envio")),
            shipping_reference=normalize_text(row.get("referencia_de_envio")),
            shipping_district_code=(
                shipping_district_code.zfill(3) if shipping_district_code else None
            ),
            shipping_district_name=normalize_text(row.get("distrito_envio")),
            shipping_zone_name=normalize_text(row.get("zona_envio")),
            score=(year, month, completeness),
        )
        current = latest.get(supply_code)
        if current is None or record.score > current.score:
            latest[supply_code] = record

    return latest


def resolve_cua(
    label: str | None,
    tariff: str | None,
    catalog: list[tuple[int, str, str]],
) -> tuple[int | None, str]:
    normalized = normalize_catalog_label(label)
    if not normalized:
        return None, "EMPTY"

    tariff_prefix = TARIFF_CUA_PREFIX.get(normalize_catalog_label(tariff).lower())

    exact = [item for item in catalog if normalize_catalog_label(item[2]) == normalized]
    if len(exact) == 1:
        return exact[0][0], "EXACT"
    exact_for_tariff = [item for item in exact if item[1].startswith(tariff_prefix or "")]
    if tariff_prefix is not None and len(exact_for_tariff) == 1:
        return exact_for_tariff[0][0], "EXACT"

    prefix = [
        item
        for item in catalog
        if len(normalize_catalog_label(item[2])) >= 12
        and (
            normalized.startswith(normalize_catalog_label(item[2]))
            or normalize_catalog_label(item[2]).startswith(normalized)
        )
    ]
    if len(prefix) == 1:
        return prefix[0][0], "PREFIX"
    prefix_for_tariff = [item for item in prefix if item[1].startswith(tariff_prefix or "")]
    if tariff_prefix is not None and len(prefix_for_tariff) == 1:
        return prefix_for_tariff[0][0], "PREFIX"
    return None, "UNRESOLVED"


def import_links(path: Path, dry_run: bool) -> dict[str, int]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL no esta configurada")

    records = read_latest_records(path)
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, code, description
                FROM public.supervision_code_catalog
                WHERE catalog_key = 'catalog_045'
                ORDER BY display_order, id
                """
            )
            catalog = [(int(row[0]), row[1], row[2]) for row in cursor.fetchall()]
            if not catalog:
                raise RuntimeError("El catalogo CUA catalog_045 esta vacio")

            cursor.execute(
                """
                CREATE TEMP TABLE stage_supply_catastro_links (
                  supply_code text PRIMARY KEY,
                  source_lot_code text,
                  source_district_code text,
                  source_district_name text,
                  tariff text,
                  cua_label text,
                  cua_catalog_id bigint,
                  cua_match_method text NOT NULL,
                  sec_cta text,
                  scheme_code text,
                  shipping_street text,
                  shipping_municipal_number text,
                  shipping_duplicator text,
                  shipping_locality text,
                  shipping_reference text,
                  shipping_district_code text,
                  shipping_district_name text,
                  shipping_zone_name text
                ) ON COMMIT DROP
                """
            )
            with cursor.copy(
                """
                COPY stage_supply_catastro_links (
                  supply_code, source_lot_code, source_district_code,
                  source_district_name, tariff, cua_label, cua_catalog_id,
                  cua_match_method, sec_cta, scheme_code, shipping_street,
                  shipping_municipal_number, shipping_duplicator,
                  shipping_locality, shipping_reference, shipping_district_code,
                  shipping_district_name, shipping_zone_name
                ) FROM STDIN
                """
            ) as copy:
                for record in records.values():
                    cua_catalog_id, cua_match_method = resolve_cua(
                        record.cua_label, record.tariff, catalog
                    )
                    copy.write_row(
                        (
                            record.supply_code,
                            record.cup_code,
                            record.source_district_code,
                            record.source_district_name,
                            record.tariff,
                            record.cua_label,
                            cua_catalog_id,
                            cua_match_method,
                            record.sec_cta,
                            record.scheme_code,
                            record.shipping_street,
                            record.shipping_municipal_number,
                            record.shipping_duplicator,
                            record.shipping_locality,
                            record.shipping_reference,
                            record.shipping_district_code,
                            record.shipping_district_name,
                            record.shipping_zone_name,
                        )
                    )

            cursor.execute(
                """
                SELECT count(*)
                FROM stage_supply_catastro_links stage
                LEFT JOIN public.customer_supplies supply
                  ON supply.supply_code = stage.supply_code
                WHERE supply.id IS NULL
                """
            )
            missing_supplies = int(cursor.fetchone()[0])
            if missing_supplies:
                raise RuntimeError(
                    f"Hay {missing_supplies} NIS que no existen en customer_supplies"
                )

            cursor.execute(
                """
                INSERT INTO public.territory_districts (
                  district_code, name, in_gis_export, note, source_file
                )
                SELECT source_district_code, min(source_district_name), false,
                       'Distrito incorporado desde el archivo comercial de suministros', %s
                FROM stage_supply_catastro_links
                WHERE source_district_code ~ '^[0-9]{3}$'
                  AND nullif(btrim(source_district_name), '') IS NOT NULL
                GROUP BY source_district_code
                ON CONFLICT (district_code) DO NOTHING
                """,
                [path.name],
            )

            cursor.execute(
                """
                WITH cups AS (
                  SELECT DISTINCT source_lot_code AS cup_code,
                         substr(source_lot_code, 1, 8) AS cod_mza,
                         substr(source_lot_code, 1, 3) AS district_code
                  FROM stage_supply_catastro_links
                  WHERE source_lot_code ~ '^[0-9]{12}$'
                ), block_stats AS (
                  SELECT cups.cod_mza,
                         count(DISTINCT lot.block_id)::int AS block_count,
                         (array_agg(DISTINCT lot.block_id)
                           FILTER (WHERE lot.block_id IS NOT NULL))[1] AS block_id
                  FROM cups
                  LEFT JOIN public.gis_lots lot ON lot.cup_code = cups.cup_code
                  GROUP BY cups.cod_mza
                )
                INSERT INTO public.gis_cadastral_blocks (
                  cod_mza, district_code, gis_block_id, gis_block_match_count,
                  source_file, imported_at, updated_at
                )
                SELECT cups.cod_mza, cups.district_code,
                       CASE WHEN stats.block_count = 1 THEN stats.block_id END,
                       stats.block_count, %s, now(), now()
                FROM (SELECT DISTINCT cod_mza, district_code FROM cups) cups
                JOIN public.territory_districts district
                  ON district.district_code = cups.district_code
                JOIN block_stats stats ON stats.cod_mza = cups.cod_mza
                ON CONFLICT (cod_mza) DO UPDATE SET
                  district_code = EXCLUDED.district_code,
                  gis_block_id = EXCLUDED.gis_block_id,
                  gis_block_match_count = EXCLUDED.gis_block_match_count,
                  source_file = EXCLUDED.source_file,
                  updated_at = now()
                """,
                [path.name],
            )

            cursor.execute(
                """
                WITH cups AS (
                  SELECT DISTINCT source_lot_code AS cup_code,
                         substr(source_lot_code, 1, 8) AS cod_mza,
                         substr(source_lot_code, 1, 3) AS district_code
                  FROM stage_supply_catastro_links
                  WHERE source_lot_code ~ '^[0-9]{12}$'
                ), stats AS (
                  SELECT cups.cup_code, count(lot.id)::int AS lot_count,
                         count(DISTINCT lot.block_id)::int AS block_count
                  FROM cups
                  LEFT JOIN public.gis_lots lot ON lot.cup_code = cups.cup_code
                  GROUP BY cups.cup_code
                )
                INSERT INTO public.gis_cadastral_lot_units (
                  cup_code, cod_mza, district_code, gis_lot_match_count,
                  geometry_match_status, source_file, imported_at, updated_at
                )
                SELECT cups.cup_code, cups.cod_mza, cups.district_code,
                       stats.lot_count,
                       CASE
                         WHEN stats.lot_count = 0 THEN 'NO_GEOMETRY'
                         WHEN stats.lot_count = 1 THEN 'UNIQUE_GEOMETRY'
                         WHEN stats.block_count <= 1 THEN 'MULTIPARCEL_SAME_BLOCK'
                         ELSE 'MULTIBLOCK'
                       END,
                       %s, now(), now()
                FROM cups
                JOIN public.gis_cadastral_blocks block ON block.cod_mza = cups.cod_mza
                JOIN stats ON stats.cup_code = cups.cup_code
                ON CONFLICT (cup_code) DO UPDATE SET
                  cod_mza = EXCLUDED.cod_mza,
                  district_code = EXCLUDED.district_code,
                  gis_lot_match_count = EXCLUDED.gis_lot_match_count,
                  geometry_match_status = EXCLUDED.geometry_match_status,
                  source_file = EXCLUDED.source_file,
                  updated_at = now()
                """,
                [path.name],
            )

            cursor.execute(
                """
                DELETE FROM public.gis_cadastral_lot_geometries bridge
                USING stage_supply_catastro_links stage
                WHERE bridge.cup_code = stage.source_lot_code
                """
            )
            cursor.execute(
                """
                INSERT INTO public.gis_cadastral_lot_geometries (cup_code, gis_lot_id)
                SELECT DISTINCT unit.cup_code, lot.id
                FROM public.gis_cadastral_lot_units unit
                JOIN stage_supply_catastro_links stage
                  ON stage.source_lot_code = unit.cup_code
                JOIN public.gis_lots lot ON lot.cup_code = unit.cup_code
                ON CONFLICT DO NOTHING
                """
            )

            cursor.execute(
                """
                INSERT INTO public.gis_supply_lot_links (
                  supply_id, supply_code, cup_code, district_code,
                  source_lot_code, source_district_code, source_district_name,
                  district_match_status, cua_catalog_id, cua_label,
                  cua_match_method, source_file, imported_at, updated_at
                )
                SELECT supply.id, stage.supply_code, unit.cup_code,
                       coalesce(unit.district_code, source_district.district_code),
                       stage.source_lot_code, stage.source_district_code,
                       stage.source_district_name,
                       CASE
                         WHEN stage.source_lot_code !~ '^[0-9]{12}$'
                           OR stage.source_lot_code IS NULL THEN 'INVALID_LOT_CODE'
                         WHEN unit.cup_code IS NULL THEN 'UNKNOWN_DISTRICT'
                         WHEN stage.source_district_code IS DISTINCT FROM unit.district_code
                           THEN 'SOURCE_MISMATCH'
                         ELSE 'MATCHED'
                       END,
                       stage.cua_catalog_id, stage.cua_label,
                       stage.cua_match_method, %s, now(), now()
                FROM stage_supply_catastro_links stage
                JOIN public.customer_supplies supply
                  ON supply.supply_code = stage.supply_code
                LEFT JOIN public.gis_cadastral_lot_units unit
                  ON unit.cup_code = stage.source_lot_code
                LEFT JOIN public.territory_districts source_district
                  ON source_district.district_code = stage.source_district_code
                ON CONFLICT (supply_id) DO UPDATE SET
                  supply_code = EXCLUDED.supply_code,
                  cup_code = EXCLUDED.cup_code,
                  district_code = EXCLUDED.district_code,
                  source_lot_code = EXCLUDED.source_lot_code,
                  source_district_code = EXCLUDED.source_district_code,
                  source_district_name = EXCLUDED.source_district_name,
                  district_match_status = EXCLUDED.district_match_status,
                  cua_catalog_id = EXCLUDED.cua_catalog_id,
                  cua_label = EXCLUDED.cua_label,
                  cua_match_method = EXCLUDED.cua_match_method,
                  source_file = EXCLUDED.source_file,
                  updated_at = now()
                """,
                [path.name],
            )

            cursor.execute(
                """
                INSERT INTO public.customer_supply_catastro_extensions (
                  supply_id, supply_code, sec_cta, scheme_code, shipping_street,
                  shipping_municipal_number, shipping_duplicator, shipping_locality,
                  shipping_reference, shipping_district_code, shipping_district_name,
                  shipping_zone_name, source_file, imported_at, updated_at
                )
                SELECT supply.id, stage.supply_code, stage.sec_cta, stage.scheme_code,
                       stage.shipping_street, stage.shipping_municipal_number,
                       stage.shipping_duplicator, stage.shipping_locality,
                       stage.shipping_reference, stage.shipping_district_code,
                       stage.shipping_district_name, stage.shipping_zone_name,
                       %s, now(), now()
                FROM stage_supply_catastro_links stage
                JOIN public.customer_supplies supply
                  ON supply.supply_code = stage.supply_code
                ON CONFLICT (supply_id) DO UPDATE SET
                  supply_code = EXCLUDED.supply_code,
                  sec_cta = EXCLUDED.sec_cta,
                  scheme_code = EXCLUDED.scheme_code,
                  shipping_street = EXCLUDED.shipping_street,
                  shipping_municipal_number = EXCLUDED.shipping_municipal_number,
                  shipping_duplicator = EXCLUDED.shipping_duplicator,
                  shipping_locality = EXCLUDED.shipping_locality,
                  shipping_reference = EXCLUDED.shipping_reference,
                  shipping_district_code = EXCLUDED.shipping_district_code,
                  shipping_district_name = EXCLUDED.shipping_district_name,
                  shipping_zone_name = EXCLUDED.shipping_zone_name,
                  source_file = EXCLUDED.source_file,
                  updated_at = now()
                """,
                [path.name],
            )

            cursor.execute(
                """
                SELECT
                  count(*)::int,
                  count(*) FILTER (WHERE cup_code IS NOT NULL)::int,
                  count(*) FILTER (WHERE cua_catalog_id IS NOT NULL)::int,
                  count(*) FILTER (WHERE district_match_status = 'MATCHED')::int,
                  count(*) FILTER (WHERE district_match_status = 'SOURCE_MISMATCH')::int
                FROM public.gis_supply_lot_links
                WHERE source_file = %s
                """,
                [path.name],
            )
            total, linked_lots, linked_cua, matched_districts, district_mismatches = cursor.fetchone()

            if dry_run:
                connection.rollback()
            else:
                connection.commit()

    return {
        "supplies": int(total),
        "linked_lots": int(linked_lots),
        "linked_cua": int(linked_cua),
        "matched_districts": int(matched_districts),
        "district_mismatches": int(district_mismatches),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Relaciona el catastro comercial con distrito, manzana, lote y CUA"
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = import_links(args.source, args.dry_run)
    prefix = "Dry-run correcto" if args.dry_run else "Importacion completada"
    print(prefix + ": " + ", ".join(f"{key}={value}" for key, value in result.items()))


if __name__ == "__main__":
    main()
