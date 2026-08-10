from fastapi import APIRouter

from app.auth import CurrentUser, authenticate_and_issue_session, logout_user, refresh_session
from app.schemas import LoginRequest, RefreshRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def session_response(payload: dict) -> dict:
    return {
        "accessToken": payload["access_token"],
        "refreshToken": payload["refresh_token"],
        "expiresIn": payload["expires_in"],
        "tokenType": "bearer",
        "user": payload["user"],
    }


@router.post("/login")
async def login(body: LoginRequest) -> dict:
    session = await authenticate_and_issue_session(body.identifier, body.password)
    return session_response(session)


@router.post("/refresh")
async def refresh(body: RefreshRequest) -> dict:
    session = await refresh_session(body.refreshToken)
    return session_response(session)


@router.get("/me")
async def me(user: CurrentUser) -> dict:
    return {
        "id": user.get("sub"),
        "email": user.get("email"),
        "role": user.get("role", "authenticated"),
    }


@router.post("/logout")
async def logout(user: CurrentUser) -> dict:
    await logout_user(str(user.get("sub")))
    return {"success": True}
