import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import close_pool, get_pool, open_pool


async def main() -> None:
    parser = argparse.ArgumentParser(description="Ejecuta una migración SQL de SEDAPAL GIS")
    parser.add_argument("migration", type=Path)
    args = parser.parse_args()
    sql = args.migration.read_text(encoding="utf-8")
    await open_pool()
    try:
        async with get_pool().connection() as connection:
            await connection.execute(sql)
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
