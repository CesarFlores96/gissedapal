import asyncio
import os
import subprocess
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import close_pool, get_pool, open_pool
from app.repositories.gis import sync_supply_locations
from app.routers import auth, gis, reportes, updater


async def keep_supply_locations_synced() -> None:
    while True:
        await asyncio.sleep(60)
        await sync_supply_locations(get_pool())


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await open_pool()
        await sync_supply_locations(get_pool())
        sync_task = asyncio.create_task(keep_supply_locations_synced())
    except Exception as e:
        print(f"[WARN] No se pudo conectar a la BD: {e}")
        print("[WARN] El servidor arranca pero las rutas que requieren BD fallarán")
        sync_task = None
    
    # Iniciar Martin localmente en el servidor si existe el ejecutable
    martin_process = None
    try:
        app_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(os.path.dirname(app_dir))
        
        # Intentar buscar el sidecar de martin
        martin_bin = os.path.join(project_root, "src-tauri", "binaries", "martin-x86_64-pc-windows-msvc.exe")
        martin_config = os.path.join(project_root, "src-tauri", "resources", "martin.yaml")
        
        if os.path.exists(martin_bin) and os.path.exists(martin_config):
            env = os.environ.copy()
            env["MARTIN_DATABASE_URL"] = settings.database_url
            # Ejecutar Martin en puerto 3000
            martin_process = subprocess.Popen(
                [
                    martin_bin,
                    "--config", martin_config,
                    "--listen-addresses", "127.0.0.1:3000"
                ],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            print("Servidor de tiles Martin iniciado automáticamente en puerto 3000.")
        else:
            print(f"No se encontró el ejecutable de Martin en {martin_bin} o la configuración en {martin_config}.")
    except Exception as e:
        print(f"Advertencia: No se pudo iniciar el servidor de tiles Martin: {e}")

    try:
        yield
    finally:
        if martin_process:
            print("Deteniendo servidor de tiles Martin...")
            martin_process.terminate()
            with suppress(Exception):
                martin_process.wait(timeout=3)
            if martin_process.poll() is None:
                martin_process.kill()

        if sync_task:
            sync_task.cancel()
            with suppress(asyncio.CancelledError):
                await sync_task
        with suppress(Exception):
            await close_pool()


settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({"detail": "Solicitud inválida.", "errors": exc.errors()}),
    )


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"success": True, "service": "sedapalgis-api", "version": "1.0.0"}


app.include_router(auth.router, prefix="/api/v1")
app.include_router(gis.router, prefix="/api/v1")
app.include_router(reportes.router, prefix="/api/v1")

# Sin prefijo /api/v1: es el contrato fijo que consume el updater de Tauri
# (tauri.conf.json -> plugins.updater.endpoints), no una API de negocio versionada.
app.include_router(updater.router)
os.makedirs(settings.updater_releases_dir, exist_ok=True)
app.mount(
    "/updater/files",
    StaticFiles(directory=settings.updater_releases_dir),
    name="updater-files",
)
