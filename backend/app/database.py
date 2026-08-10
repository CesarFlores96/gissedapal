import asyncio
import sys

from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

pool: AsyncConnectionPool | None = None

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def open_pool() -> None:
    global pool
    if pool is None:
        pool = AsyncConnectionPool(
            conninfo=get_settings().database_url,
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"autocommit": True, "prepare_threshold": None},
        )
    await pool.open()


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None


def get_pool() -> AsyncConnectionPool:
    if pool is None:
        raise RuntimeError("El pool PostgreSQL no está inicializado.")
    return pool
