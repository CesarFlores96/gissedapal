# CLAUDE.md

> **Frontera vigente (2026-09-07):** el unico backend es
> `D:\sedapal-backend-aws`, que corre en la instancia AWS Lightsail contra el
> PostgreSQL de esa misma instancia (no hay base de datos local). `D:\BD_LOCAL`
> quedo deprecado y `D:\BD_LOCAL\api-fastapi` fue borrado el 2026-09-07: no
> existe, no debe recrearse ni referenciarse en ninguna instruccion nueva.
> `backend/` (dentro de este repo) sigue siendo referencia historica; su
> `run_local.ps1` ya no aplica a ningun backend vigente.

> **Precedencia:** si una seccion historica posterior contradice esta frontera,
> prevalece esta nota. No iniciar `backend/`, `uvicorn --reload`, `8010`, ni
> nada contra `D:\BD_LOCAL` (ya no existe) desde SEDAPALGIS.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

SEDAPAL GIS is a Windows desktop app (Tauri 2 + React 19 + TypeScript) for visualizing GIS/cadastral data for Lima. It is a three-tier system:

- **Frontend** (`src/`): React 19 + MapLibre GL, running inside the Tauri webview.
- **Tauri shell** (`src-tauri/`, Rust): not just a webview wrapper — it's the app's BFF. It owns auth/session and proxies every call to the FastAPI backend over `reqwest`, caching responses in memory. It does **not** talk to PostgreSQL and does **not** manage the `martin` sidecar (the Python backend spawns it).
- **API backend** (`backend/`, Python/FastAPI): stateless HTTP API backed by PostgreSQL + PostGIS.

**The frontend never calls the FastAPI backend or Postgres directly.** All data access goes through Tauri `invoke()` commands (`src/lib/ipc.ts` → `src-tauri/src/lib.rs`). Keep this boundary when adding features: new data needs = new Tauri command wrapping an authenticated HTTP call, then a typed wrapper in `ipc.ts`. There is no SQL in Rust — persistence always goes through a FastAPI endpoint.

## Commands

### Frontend (from repo root)

```powershell
pnpm install
pnpm dev              # Vite dev server only, http://127.0.0.1:1420
pnpm tauri dev         # full desktop app (Vite + Rust shell)
pnpm typecheck         # tsc -b --pretty false
pnpm lint              # eslint src --max-warnings 0
pnpm test              # vitest run
pnpm build             # tsc -b && vite build
pnpm tauri build        # production installer -> dist/
```

Run a single frontend test file or test name:

```powershell
pnpm exec vitest run src/features/indicators/mdiState.test.ts
pnpm exec vitest run -t "test name substring"
```

### Backend (FastAPI)

```powershell
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"   # setup
backend\scripts\run_local.ps1                                        # start API on :8010 with --reload
backend\.venv\Scripts\python.exe -m pytest backend\tests -v          # all tests
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_gis_integration.py::test_name -v  # single test
backend\scripts\test_local.ps1
```

`run_local.ps1` sources env vars from sibling repos on this dev machine (`D:\BD_LOCAL\api-fastapi\.env` for `DATABASE_URL`/`AUTH_JWT_SECRET`, `D:\Sedapal\apps\web\.env` for the Supabase values) rather than a local `.env` — if those paths aren't present, set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUTH_JWT_SECRET` manually before running uvicorn directly.

### Rust / Tauri

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
```

### Database migrations

> **Vigente:** el esquema activo vive en `scripts/sql/NNN_*.sql` dentro de `D:\sedapal-backend-aws` (up-only, sin runner ni tabla de tracking: se aplican a mano contra el PostgreSQL de AWS y luego se commitean como registro de reconstrucción). Lo que sigue es historia de `backend/`, que está deprecado.

Migrations live in `backend/migrations/` as paired `NNN_name.up.sql` / `.down.sql`, run in numeric order via:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\run_migration.py backend\migrations\<file>.up.sql
```

District import: `backend\scripts\import_districts.py data\lima_callao_distritos.geojson`. Cadastral import/enrichment scripts (`import_sedapal_catastro.py`, `enrich_catastro_from_xls.py`, `import_supply_catastro_links.py`) pull from SEDAPAL's public cadastral layers/XLS and validate the full download before committing — imports are transactional (all-or-nothing).

### Publishing an auto-update release

The app checks the GitHub Releases `latest.json` endpoint configured in `src-tauri/tauri.conf.json` on every boot (`src/app/session/SessionProvider.tsx`) via `tauri-plugin-updater`, and self-installs + relaunches if a newer signed build is available. The signing keypair lives outside the repo (`%USERPROFILE%\.tauri\sedapalgis-updater.key`); only its public half is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

To cut a release:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\sedapalgis-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password from the password manager>"
pnpm tauri build
scripts\publish-release.ps1 -Version "0.2.0" -Notes "Descripción del release"
```

`publish-release.ps1` copies the signed `.nsis.zip` from `src-tauri/target/release/bundle/nsis/` into `backend/releases/<version>/` and writes `backend/releases/latest.json`, which `backend/app/routers/updater.py` serves. Restart the backend (or make sure it's running) so clients pick it up.

## Architecture details

### Tauri Rust layer (`src-tauri/src/`)

- `lib.rs` — `AppState`: holds the FastAPI base URL, an `reqwest` client, the current auth session (in-memory `Mutex`), and a bounded in-memory response cache (60s TTL, 64 entries, LRU-ish eviction) keyed by request params. All `#[tauri::command]` handlers live here (`login`, `logout`, `get_session`, `fetch_gis_layers`, `fetch_districts`, `resolve_location`, `get_supply_detail/consumption/report`, `get_abrupt_consumption_drops`, `get_reports_master`, `search_cadastre`, `save_geometry_correction`, `open_maps_window`, `get_tile_server_url`, `get_lot_context`).
- **Auth/session**: access token kept in memory; refresh token persisted in the OS credential store via `keyring` (service `pe.sedapal.gis`). `access_token()` auto-refreshes when the token is near expiry or on a 401 retry.
- **API base URL resolution** (`configured_api_url`): `SEDAPALGIS_API_URL` env var → `%LOCALAPPDATA%\SEDAPALGIS\api-url.txt` → default `https://sedapalweb.com/fastapi/`. The exact legacy production override is migrated automatically; custom, localhost and SEDAPAL LAN overrides are preserved. `validate_base_url` rejects unsafe schemes, embedded credentials, query/fragment components and keeps the `/fastapi/` prefix.
- **Postgres**: no hay acceso directo desde Rust. No existe `sqlx` ni ningún driver de base de datos en `src-tauri/Cargo.toml`; todo pasa por FastAPI. El único secreto en el keyring (`pe.sedapal.gis`) es `refresh-token`, más `ollama-master-key` que agrega el módulo de fotos de medidores.
- **Tile server**: `get_tile_server_url` solo le pide al backend la URL base de tiles. El sidecar `martin` lo lanza el backend Python; Rust no lo administra (`src-tauri/binaries/` y `resources/martin.yaml` quedan como residuo histórico, sin referencias en código).
- **`open_maps_window`**: deliberately builds the Google Maps URL in Rust from `(lat, lng, mode)` only — the frontend cannot pass an arbitrary URL, closing off an open-redirect-style IPC surface into a real browser window.
- **`get_lot_context`**: consulta el lote catastral vía FastAPI como todo lo demás. (No existen `domain/lot_context.rs` ni `commands/lot_context.rs`: `src-tauri/src/` son archivos planos — `lib.rs`, `streetview.rs`, `lot_split.rs`, `crypto.rs`, `meter_*.rs`, `main.rs`.)

### FastAPI backend (`backend/app/`)

- Routers, all under `/api/v1`: `auth` (`/login`, `/refresh`, `/me`, `/logout`), `gis` (`/distritos`, `/catastro/buscar`, `/catastro/ajuste`, `/capas`, `/suministro/{code}`, `/suministro/{code}/consumo`, `/relacion`), `reportes` (`/master`, `/anomalias/caidas-consumo`, `/suministro/{code}`).
- Auth is **local**: JWTs are minted/verified by this service (`app/auth.py`, `AUTH_JWT_SECRET`). Supabase is used *only* to verify the password on `/auth/login` (password grant) — session state, refresh, and verification never touch Supabase afterward.
- `app/main.py` lifespan starts a background task that re-syncs supply locations (`sync_supply_locations`) every 60s.
- CORS is locked to `http://localhost:1420` and `tauri://localhost` by default (`ALLOWED_ORIGINS`).
- Layered as `routers/` → `repositories/` (raw SQL/PostGIS access) → `services/` (e.g. `consumption_analysis.py`); `schemas.py` holds pydantic models.

### Frontend (`src/`)

- `lib/ipc.ts` — the only bridge to the backend; every exported function wraps one Tauri `invoke()` call and adapts snake_case API payloads to the camelCase types in `types.ts`.
- `components/` — feature panels (`MapView`, `LayerPanel`, `ReportsWorkspace`, `ReportPanel`, `InspectorDrawer`, `LoginPage`) plus `components/ui/` (shadcn-derived primitives on `@base-ui/react`). El chrome de la app es `app/shell/` (`AppShell`, `Sidebar`, `PageHeader`); las alertas de consumo viven en `routes/AlertsRoute.tsx`.
- `features/indicators/` — an MDI (multi-document interface) workspace for indicator views: `mdiState.ts`/`mdiContext.ts` hold the window layout state machine, `MdiProvider.tsx`/`MdiWorkspace.tsx` render it, `indicatorCatalog.ts` defines the available indicators.
- `features/map/lotContext.ts` — shared state for the currently-selected cadastral lot/block, used by both the map and the inspector drawer.
- Heavy panels (`MapView`, `ReportPanel`) are lazy-loaded (`React.lazy`) from `App.tsx`.
- Path alias `@` → `src/` (see `vite.config.ts`).

### Análisis masivo de fotografías de medidores (`src/features/meter-photos/`)

Módulo local: el usuario elige una carpeta, cada foto se manda a Ollama Cloud
**desde Rust** y el informe normalizado se persiste en Postgres vía FastAPI.
Las fotografías nunca salen hacia el backend, y el módulo jamás renombra, mueve
ni borra un archivo de la carpeta elegida.

- **Ruta**: `/analisis/fotos-medidores` (`lazy`, arrastra d3-force y el canvas).
  El rótulo `Fotografías de medidores` debe coincidir en `Sidebar.tsx`, el
  `handle.title` de `routes.tsx` y el `<h1>` del workspace.
- **Rust**: `meter_normalize.rs` (capa determinista de consistencia, **pura y
  muy testeada** — es el corazón del módulo), `meter_analysis.rs` (escaneo,
  EXIF, cola, eventos), `meter_excel.rs` (`ExcelRow` tiene exactamente las diez
  columnas del informe, por tipo), `crypto.rs` (AES-256-GCM).
- **Cola**: cancelación por contador de generación + `abort()`, igual que
  `streetview.rs`. Concurrencia 1 por defecto. Eventos `meter-analysis:*`;
  **nunca** se manda base64 en un evento (una corrida de 900 fotos saturaría el
  canal IPC) — las fotos van solo por `get_meter_photo`, bajo demanda.
- **API key**: se cifra en Rust; a Postgres solo viaja el ciphertext. La clave
  maestra vive en el keyring (`ollama-master-key`) de cada PC, así que una key
  configurada en otra máquina no se puede descifrar acá: se detecta por
  `keyId` **antes** de escanear, no a mitad de cola. Ningún comando devuelve la
  key en claro; `get_meter_analysis_config` quita ciphertext y nonce.
- **`get_meter_photo`** recibe una ruta arbitraria del webview: sin la lista de
  carpetas permitidas (alimentada solo por el diálogo nativo) sería una
  primitiva de lectura de archivos arbitrarios. Valida con `canonicalize` +
  `Path::starts_with` — nunca `str::starts_with`.
- **Prompts versionados**: editar inserta `version + 1` y mueve `is_active`;
  las filas nunca se actualizan in situ, para que cada ejecución pueda citar el
  texto exacto con el que analizó.
- **Búsqueda**: `ILIKE` no ignora tildes y todas las incidencias las llevan, así
  que el SQL pliega con `translate(lower(...))` en ambos lados (`_folded` /
  `_folded_literal` en `app/sedapalgis/repositories/fotos.py`).
- **Esquema**: `scripts/sql/019_photo_analysis_config.sql` y `020_photo_analysis_runs.sql`
  en `sedapal-backend-aws`.

## Key conventions

- TypeScript/React: PascalCase components, `use`-prefixed camelCase hooks, Tailwind for styling.
- Python: snake_case modules/functions, PascalCase classes, settings via `pydantic-settings` (`app/config.py`).
- Rust: snake_case modules/functions, PascalCase types; comments in this codebase are written in Spanish and are reserved for non-obvious security/behavioral rationale (see `lib.rs`) — match that style rather than adding routine doc comments.
- Vite dev server is pinned to `127.0.0.1:1420` (not the Vite default) because `tauri.conf.json`'s `devUrl` and the app's CSP `connect-src` hardcode that origin.
