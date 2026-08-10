import argparse
import asyncio
import json
from pathlib import Path

from psycopg.types.json import Jsonb

from app.database import close_pool, get_pool, open_pool


async def import_districts(path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") or []
    imported = 0
    async with get_pool().connection() as connection:
        async with connection.cursor() as cursor:
            for feature in features:
                properties = feature.get("properties") or {}
                geometry = feature.get("geometry")
                name = properties.get("distrito2") or properties.get("distrito")
                if not name or not geometry:
                    continue
                await cursor.execute(
                    """
                    INSERT INTO public.gis_districts
                      (name, province, department, source, geom, properties, updated_at)
                    VALUES (%s, %s, %s, 'IGN',
                      ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))), %s, now())
                    ON CONFLICT (name, province, department) DO UPDATE SET
                      source = EXCLUDED.source,
                      geom = EXCLUDED.geom,
                      properties = EXCLUDED.properties,
                      updated_at = now()
                    """,
                    [
                        str(name).strip(),
                        properties.get("provincia"),
                        properties.get("departamento"),
                        json.dumps(geometry),
                        Jsonb(properties),
                    ],
                )
                imported += 1
    return imported


async def main() -> None:
    parser = argparse.ArgumentParser(description="Importa distritos IGN en PostGIS")
    parser.add_argument("geojson", type=Path)
    args = parser.parse_args()
    await open_pool()
    try:
        count = await import_districts(args.geojson)
        print(f"Distritos importados: {count}")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())

