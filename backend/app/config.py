from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=[".env.local", ".env"], env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="SEDAPAL GIS API", alias="APP_NAME")
    database_url: str = Field(alias="DATABASE_URL")
    # Opcional: el backend sigue funcionando sin Redis, solo sin caché compartida.
    redis_url: str | None = Field(default=None, alias="REDIS_URL")
    # Único uso restante de Supabase: confirmar la contraseña en /auth/login
    # contra su endpoint de password grant. La sesión (tokens, expiración,
    # verificación) es enteramente local -- ver app/auth.py.
    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_anon_key: str = Field(alias="SUPABASE_ANON_KEY")
    auth_jwt_secret: str = Field(alias="AUTH_JWT_SECRET")
    auth_access_token_ttl_seconds: int = Field(default=3600, alias="AUTH_ACCESS_TOKEN_TTL_SECONDS")
    auth_refresh_token_ttl_days: int = Field(default=30, alias="AUTH_REFRESH_TOKEN_TTL_DAYS")
    allowed_origins: str = Field(
        default="http://localhost:1420,tauri://localhost", alias="ALLOWED_ORIGINS"
    )
    # El instalador firmado y el manifiesto de cada release se sirven desde este
    # directorio (ver app/routers/updater.py); scripts/publish-release.ps1 lo llena.
    updater_releases_dir: str = Field(default="releases", alias="UPDATER_RELEASES_DIR")
    updater_public_base_url: str = Field(
        default="https://sedapalweb.com/fastapi", alias="UPDATER_PUBLIC_BASE_URL"
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
