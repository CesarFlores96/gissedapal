"""Caché compartida no autoritativa para MVT y reportes.

Redis/Valkey es opcional por diseño: una indisponibilidad nunca impide leer la
fuente de verdad. Las revisiones viven en PostgreSQL y forman parte de la clave,
por lo que una invalidación no exige borrar claves masivamente.
"""

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.config import get_settings

logger = logging.getLogger(__name__)
T = TypeVar("T")
REVISION_CACHE_SECONDS = 10


class SharedCache:
    def __init__(self) -> None:
        self._client: Redis | None = None
        self._disabled = False
        self._revision_cache: dict[str, tuple[int, float]] = {}

    async def open(self) -> None:
        url = get_settings().redis_url
        if not url:
            self._disabled = True
            return
        try:
            client = Redis.from_url(url, decode_responses=False, socket_connect_timeout=1, socket_timeout=1)
            await client.ping()
            self._client = client
            self._disabled = False
        except RedisError as exc:
            self._disabled = True
            logger.warning("Redis no disponible; se usará la fuente de verdad: %s", exc)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
        self._client = None

    async def get_bytes(self, key: str) -> bytes | None:
        if self._client is None or self._disabled:
            return None
        try:
            value = await self._client.get(key)
            return bytes(value) if value is not None else None
        except RedisError as exc:
            logger.warning("Fallo leyendo caché %s: %s", key, exc)
            return None

    async def set_bytes(self, key: str, value: bytes, ttl_seconds: int) -> None:
        if self._client is None or self._disabled:
            return
        try:
            await self._client.set(key, value, ex=ttl_seconds)
        except RedisError as exc:
            logger.warning("Fallo escribiendo caché %s: %s", key, exc)

    async def get_json(self, key: str) -> dict[str, Any] | None:
        value = await self.get_bytes(key)
        if value is None:
            return None
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    async def set_json(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        await self.set_bytes(key, json.dumps(value, separators=(",", ":"), default=str).encode("utf-8"), ttl_seconds)

    async def revision(self, pool: AsyncConnectionPool, domain: str) -> int:
        cached = self._revision_cache.get(domain)
        now = time.monotonic()
        if cached and cached[1] > now:
            return cached[0]
        try:
            async with pool.connection() as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        "SELECT revision FROM public.cache_revisions WHERE domain = %s", [domain]
                    )
                    row = await cursor.fetchone()
            revision = int(row["revision"]) if row else 1
        except Exception as exc:  # migración aún no aplicada: comportamiento sin caché versionada
            logger.debug("No se pudo leer revisión %s: %s", domain, exc)
            revision = 1
        self._revision_cache[domain] = (revision, now + REVISION_CACHE_SECONDS)
        return revision

    def invalidate_revision(self, domain: str, revision: int) -> None:
        self._revision_cache[domain] = (revision, time.monotonic() + REVISION_CACHE_SECONDS)


shared_cache = SharedCache()


def report_cache_key(endpoint: str, revision: int, parameters: dict[str, Any]) -> str:
    normalized = json.dumps(parameters, sort_keys=True, separators=(",", ":"), default=str)
    return f"report:{endpoint}:r{revision}:{normalized}"


async def cached_report(
    pool: AsyncConnectionPool,
    endpoint: str,
    parameters: dict[str, Any],
    ttl_seconds: int,
    loader: Callable[[], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    revision = await shared_cache.revision(pool, "reports")
    key = report_cache_key(endpoint, revision, parameters)
    cached = await shared_cache.get_json(key)
    if cached is not None:
        return {**cached, "cache": {"status": "hit", "revision": revision}}
    payload = await loader()
    payload = {**payload, "asOf": payload.get("generatedAt"), "revision": revision}
    await shared_cache.set_json(key, payload, ttl_seconds)
    return {**payload, "cache": {"status": "miss", "revision": revision}}


async def run_outbox_once(pool: AsyncConnectionPool) -> None:
    """Activa revisiones después del commit; es seguro repetir eventos."""
    try:
        async with pool.connection() as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    WITH next AS (
                      SELECT id, domain, payload FROM public.cache_outbox
                      WHERE processed_at IS NULL
                        AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')
                      ORDER BY id
                      FOR UPDATE SKIP LOCKED
                      LIMIT 20
                    )
                    UPDATE public.cache_outbox event
                    SET processing_at = now()
                    FROM next
                    WHERE event.id = next.id
                    RETURNING event.id, event.domain, event.payload
                    """
                )
                events = list(await cursor.fetchall())
                domains = {str(event["domain"]) for event in events}
                # El refresh es una barrera de publicación: la revisión de
                # reportes no cambia hasta que el snapshot esté consistente.
                requires_fact_refresh = any(
                    event["domain"] == "reports"
                    and isinstance(event["payload"], dict)
                    and event["payload"].get("table") in {
                        "public.customer_debts", "public.customer_supply_billing_daily",
                    }
                    for event in events
                )
                if requires_fact_refresh:
                    await cursor.execute(
                        "SELECT ispopulated FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'reporting_monthly_facts'"
                    )
                    materialized = await cursor.fetchone()
                    if materialized is not None:
                        statement = (
                            "REFRESH MATERIALIZED VIEW CONCURRENTLY public.reporting_monthly_facts"
                            if materialized["ispopulated"]
                            else "REFRESH MATERIALIZED VIEW public.reporting_monthly_facts"
                        )
                        await cursor.execute(statement)
                for domain in domains:
                    await cursor.execute(
                        """
                        INSERT INTO public.cache_revisions (domain, revision, updated_at)
                        VALUES (%s, 2, now())
                        ON CONFLICT (domain) DO UPDATE
                        SET revision = public.cache_revisions.revision + 1, updated_at = now()
                        RETURNING revision
                        """,
                        [domain],
                    )
                    revision_row = await cursor.fetchone()
                    revision = int(revision_row["revision"])
                    shared_cache.invalidate_revision(domain, revision)
                if events:
                    await cursor.execute(
                        "UPDATE public.cache_outbox SET processed_at = now() WHERE id = ANY(%s)",
                        [[event["id"] for event in events]],
                    )
    except Exception as exc:
        logger.debug("Outbox de caché pendiente o no disponible: %s", exc)


async def outbox_worker(pool: AsyncConnectionPool, stop: asyncio.Event) -> None:
    while not stop.is_set():
        await run_outbox_once(pool)
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except TimeoutError:
            pass
