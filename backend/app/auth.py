from datetime import datetime, timedelta, timezone
from typing import Annotated

import httpx
import jwt
from fastapi import Depends, Header, HTTPException

from app.config import get_settings
from app.repositories.auth import (
    create_refresh_token,
    consume_refresh_token,
    find_user_row_by_identifier,
    revoke_all_refresh_tokens,
    touch_last_login,
)
from app.database import get_pool

JWT_ALGORITHM = "HS256"
JWT_AUDIENCE = "sedapalgis"
JWT_ISSUER = "sedapalgis-local"


def read_bearer_token(authorization: str | None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Sesión requerida.")
    return token.strip()


# ---------------------------------------------------------------------------
# Sesión local: JWT propio (HS256) para access token, refresh token opaco
# respaldado en public.auth_refresh_tokens. Nada de esto llama a Supabase --
# solo el login (más abajo) consulta Supabase, y únicamente para confirmar que
# la contraseña es correcta.
# ---------------------------------------------------------------------------


def _issue_access_token(user: dict) -> tuple[str, int]:
    settings = get_settings()
    ttl = settings.auth_access_token_ttl_seconds
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "email": user.get("email"),
        "username": user.get("username"),
        "role": user.get("role") or "authenticated",
        "type": "access",
        "aud": JWT_AUDIENCE,
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
    }
    token = jwt.encode(payload, settings.auth_jwt_secret, algorithm=JWT_ALGORITHM)
    return token, ttl


def verify_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.auth_jwt_secret,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada.") from None
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sesión inválida.") from None
    if payload.get("type") != "access" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Sesión inválida.")
    return payload


async def get_current_user(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> dict:
    return verify_access_token(read_bearer_token(authorization))


CurrentUser = Annotated[dict, Depends(get_current_user)]


def _session_payload(user: dict, access_token: str, ttl: int, refresh_token: str) -> dict:
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": ttl,
        "user": {"id": str(user["id"]), "email": user.get("email")},
    }


async def _verify_password_with_supabase(email: str, password: str) -> bool:
    """Único punto de contacto con Supabase: confirma la contraseña con su
    endpoint de password grant. No se usa nada de lo que Supabase devuelve
    salvo el éxito/fracaso -- la sesión real (tokens, expiración, claims) es
    enteramente local."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
        response = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": settings.supabase_anon_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )
    return response.status_code < 300


async def authenticate_and_issue_session(identifier: str, password: str) -> dict:
    pool = get_pool()
    user = await find_user_row_by_identifier(pool, identifier)
    if not user:
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
    if not await _verify_password_with_supabase(user["email"], password):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")

    access_token, ttl = _issue_access_token(user)
    refresh_token = await create_refresh_token(pool, int(user["id"]), get_settings().auth_refresh_token_ttl_days)
    await touch_last_login(pool, int(user["id"]))
    return _session_payload(user, access_token, ttl, refresh_token)


async def refresh_session(raw_refresh_token: str) -> dict:
    pool = get_pool()
    user = await consume_refresh_token(pool, raw_refresh_token)
    if not user:
        raise HTTPException(status_code=401, detail="La sesión expiró.")
    access_token, ttl = _issue_access_token(user)
    refresh_token = await create_refresh_token(pool, int(user["id"]), get_settings().auth_refresh_token_ttl_days)
    return _session_payload(user, access_token, ttl, refresh_token)


async def logout_user(user_id: str) -> None:
    await revoke_all_refresh_tokens(get_pool(), int(user_id))
