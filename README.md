# SEDAPAL GIS

> Estado operativo: el único backend es `D:\BD_LOCAL\api-fastapi` en
> `http://127.0.0.1:8000` y `https://api.sedapal.lat`. El escritorio se comunica
> con FastAPI para autenticación y datos operativos; FastAPI administra su vínculo
> con Supabase. No instalar, iniciar ni desplegar `backend/`: se conserva solo
> como referencia histórica.

Aplicación de escritorio para visualizar datos GIS operativos de Lima mediante Tauri v2, React, MapLibre, FastAPI y PostgreSQL/PostGIS.

## Requisitos

- Node.js 22 y pnpm 9.
- Python 3.12.
- Rust stable MSVC, Microsoft C++ Build Tools y WebView2.
- Acceso a `bd_facturacion_local` y configuración Supabase Auth.

## Preparación

```powershell
pnpm install
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

El script local reutiliza las variables ya configuradas en los entornos Sedapal, sin copiarlas al repositorio:

```powershell
backend\scripts\run_local.ps1
pnpm tauri dev
```

El instalador usa `https://api.sedapal.lat`. En el equipo que aloja FastAPI se puede ejecutar `scripts\configure_local_api.ps1`; esto guarda `http://127.0.0.1:8000` en `%LOCALAPPDATA%\SEDAPALGIS\api-url.txt`. `SEDAPALGIS_API_URL` conserva la máxima prioridad. Se acepta HTTPS o HTTP únicamente para loopback.

## Actualizaciones automáticas mediante GitHub

La aplicación consulta `https://github.com/CesarFlores96/gissedapal/releases/latest/download/latest.json` al iniciar. Si existe una versión superior, muestra el aviso **“Nueva versión X disponible”**. La persona usuaria puede postergarla o elegir **Descargar e instalar**; se muestra el progreso y la aplicación se reinicia al terminar.

Para publicar una versión, actualiza el mismo número en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`, confirma los cambios y crea el tag:

```powershell
git tag v1.0.1
git push origin main
git push --tags
```

El workflow `.github/workflows/release.yml` compila el instalador NSIS de Windows, lo firma, crea el GitHub Release y adjunta `latest.json`. Antes de publicar, configura en GitHub Actions los secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con la clave privada que corresponde al `pubkey` ya incluido en `src-tauri/tauri.conf.json`. Nunca subas esos archivos ni sus valores al repositorio.

## Base de datos

Aplicar la migración e importar los distritos IGN desde el backend, con `DATABASE_URL` disponible en el proceso:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\run_migration.py backend\migrations\001_gis_foundation.up.sql
backend\.venv\Scripts\python.exe backend\scripts\import_districts.py data\lima_callao_distritos.geojson
backend\.venv\Scripts\python.exe backend\scripts\run_migration.py backend\migrations\002_sedapal_catastro.up.sql
backend\.venv\Scripts\python.exe backend\scripts\import_sedapal_catastro.py --district-code 010
```

La importación catastral consulta directamente las capas públicas de Catastro Comercial de SEDAPAL, valida la descarga completa y actualiza PostGIS en una sola transacción. Las manzanas se muestran desde zoom 13 y los lotes desde zoom 15. Las migraciones inversas están junto a cada migración en `backend/migrations`.

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm build
backend\.venv\Scripts\python.exe -m pytest backend\tests
backend\scripts\test_local.ps1
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
pnpm tauri build
```
