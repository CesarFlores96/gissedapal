import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from psycopg_pool import AsyncConnectionPool

from app.repositories.shared import fetch_all, fetch_one

USER_COLUMNS = "id, email, username, full_name, role, is_active"


async def find_user_row_by_identifier(pool: AsyncConnectionPool, identifier: str) -> dict | None:
    """Usuario local por email o username -- fuente de verdad de rol/estado.

    Supabase solo confirma que la contraseña es correcta; quién puede entrar
    y con qué rol lo decide siempre esta tabla local.
    """
    return await fetch_one(
        pool,
        f"""
        SELECT {USER_COLUMNS}
        FROM public.users
        WHERE is_active = true
          AND (lower(email) = lower(%s) OR lower(username) = lower(%s))
        LIMIT 1
        """,
        [identifier.strip(), identifier.strip()],
    )


async def find_user_row_by_id(pool: AsyncConnectionPool, user_id: int) -> dict | None:
    return await fetch_one(
        pool,
        f"SELECT {USER_COLUMNS} FROM public.users WHERE id = %s LIMIT 1",
        [user_id],
    )


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_refresh_token(pool: AsyncConnectionPool, user_id: int, ttl_days: int) -> str:
    """Emite un refresh token opaco; solo su hash SHA-256 se persiste."""
    raw_token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    await fetch_one(
        pool,
        """
        INSERT INTO public.auth_refresh_tokens (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        [user_id, _hash_token(raw_token), expires_at],
    )
    return raw_token


async def consume_refresh_token(pool: AsyncConnectionPool, raw_token: str) -> dict | None:
    """Valida y rota (borra) un refresh token; retorna el usuario dueño o None.

    Borrarlo al consumirlo evita reintentos: un refresh token robado y usado
    una vez deja de servir tanto para el atacante como para el cliente legítimo,
    lo cual delata la fuga en el siguiente intento de cualquiera de los dos.
    """
    row = await fetch_one(
        pool,
        """
        DELETE FROM public.auth_refresh_tokens
        WHERE token_hash = %s AND expires_at > now()
        RETURNING user_id
        """,
        [_hash_token(raw_token)],
    )
    if not row:
        return None
    return await find_user_row_by_id(pool, int(row["user_id"]))


async def revoke_all_refresh_tokens(pool: AsyncConnectionPool, user_id: int) -> None:
    await fetch_all(
        pool,
        "DELETE FROM public.auth_refresh_tokens WHERE user_id = %s RETURNING id",
        [user_id],
    )


async def touch_last_login(pool: AsyncConnectionPool, user_id: int) -> None:
    await fetch_all(
        pool,
        """
        UPDATE public.users
        SET last_login_at = now(), updated_at = now()
        WHERE id = %s
        RETURNING id
        """,
        [user_id],
    )
