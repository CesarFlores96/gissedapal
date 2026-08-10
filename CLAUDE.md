# CLAUDE.md

> **Frontera vigente (2026-08-10):** el unico backend es
> `D:\BD_LOCAL\api-fastapi` en el puerto `8000`. Tauri solo hace HTTP autenticado
> contra ese servicio: no usa `sqlx`, credenciales PostgreSQL, JWT propio ni Martin
> embebido. `backend/` es referencia historica; su `run_local.ps1` solo inicia el
> backend central. Supabase se limita a Auth, `supervision` y `planillas`.

> **Precedencia:** si una seccion historica posterior contradice esta frontera,
> prevalece esta nota. No iniciar `backend/`, `uvicorn --reload`, `8010`, `sqlx`
> ni Martin desde SEDAPALGIS.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

SEDAPAL GIS is a Windows desktop app (Tauri 2 + React 19 + TypeScript) for visualizing GIS/cadastral data for Lima. It is a three-tier system:

- **Frontend** (`src/`): React 19 + MapLibre GL, running inside the Tauri webview.
- **Tauri shell** (`src-tauri/`, Rust): not just a webview wrapper — it's the app's BFF. It owns auth/session, proxies to the FastAPI backend, holds a direct PostgreSQL connection pool, and manages a `martin` vector-tile server sidecar process.
- **API backend** (`backend/`, Python/FastAPI): stateless HTTP API backed by PostgreSQL + PostGIS.

**The frontend never calls the FastAPI backend or Postgres directly.** All data access goes through Tauri `invoke()` commands (`src/lib/ipc.ts` → `src-tauri/src/lib.rs`). Keep this boundary when adding features: new data needs = new Tauri command wrapping an authenticated HTTP call (or a direct SQL query via the `sqlx` pool for cadastral lookups), then a typed wrapper in `ipc.ts`.

## Commands

### Frontend (from repo root)

```powershell
pnpm install
pnpm dev              # Vite dev server only, http://127.0.0.1:1420
pnpm tauri dev         # full desktop app (runs dev:api + Vite + Rust + martin sidecar)
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

Migrations live in `backend/migrations/` as paired `NNN_name.up.sql` / `.down.sql`, run in numeric order (currently 001–012) via:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\run_migration.py backend\migrations\<file>.up.sql
```

District import: `backend\scripts\import_districts.py data\lima_callao_distritos.geojson`. Cadastral import/enrichment scripts (`import_sedapal_catastro.py`, `enrich_catastro_from_xls.py`, `import_supply_catastro_links.py`) pull from SEDAPAL's public cadastral layers/XLS and validate the full download before committing — imports are transactional (all-or-nothing).

### Publishing an auto-update release

The app checks `https://api.sedapal.lat/updater/{target}/{arch}/{current_version}` on every boot (`src/app/session/SessionProvider.tsx`) via `tauri-plugin-updater`, and self-installs + relaunches if a newer signed build is available. The signing keypair lives outside the repo (`%USERPROFILE%\.tauri\sedapalgis-updater.key`); only its public half is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

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
- **API base URL resolution** (`configured_api_url`): `SEDAPALGIS_API_URL` env var → `%LOCALAPPDATA%\SEDAPALGIS\api-url.txt` → default `https://api.sedapal.lat`. `validate_base_url` rejects anything that isn't `https://` or loopback `http://`.
- **Postgres**: `infrastructure/database.rs` builds a `sqlx` pool. DB URLs come from `SEDAPALGIS_DATABASE_URL` / `SEDAPALGIS_MARTIN_DATABASE_URL` env vars, falling back to OS keyring entries `business-database-url` / `martin-database-url` (same `pe.sedapal.gis` service). Non-loopback URLs are rejected unless they include `sslmode=verify-full`.
- **Tile server**: `infrastructure/martin.rs` spawns the `martin` sidecar (bundled as `externalBin` in `tauri.conf.json`, config at `src-tauri/resources/martin.yaml`) on a dynamically reserved loopback port, health-checks it (`/health`, up to 40 attempts), and exposes its URL to the frontend via `get_tile_server_url`. Killed on app exit.
- **`open_maps_window`**: deliberately builds the Google Maps URL in Rust from `(lat, lng, mode)` only — the frontend cannot pass an arbitrary URL, closing off an open-redirect-style IPC surface into a real browser window.
- **`domain/lot_context.rs`** / **`commands/lot_context.rs`**: cadastral lot lookups queried directly against Postgres (bypassing FastAPI) for latency-sensitive map interactions.

### FastAPI backend (`backend/app/`)

- Routers, all under `/api/v1`: `auth` (`/login`, `/refresh`, `/me`, `/logout`), `gis` (`/distritos`, `/catastro/buscar`, `/catastro/ajuste`, `/capas`, `/suministro/{code}`, `/suministro/{code}/consumo`, `/relacion`), `reportes` (`/master`, `/anomalias/caidas-consumo`, `/suministro/{code}`).
- Auth is **local**: JWTs are minted/verified by this service (`app/auth.py`, `AUTH_JWT_SECRET`). Supabase is used *only* to verify the password on `/auth/login` (password grant) — session state, refresh, and verification never touch Supabase afterward.
- `app/main.py` lifespan starts a background task that re-syncs supply locations (`sync_supply_locations`) every 60s.
- CORS is locked to `http://localhost:1420` and `tauri://localhost` by default (`ALLOWED_ORIGINS`).
- Layered as `routers/` → `repositories/` (raw SQL/PostGIS access) → `services/` (e.g. `consumption_analysis.py`); `schemas.py` holds pydantic models.

### Frontend (`src/`)

- `lib/ipc.ts` — the only bridge to the backend; every exported function wraps one Tauri `invoke()` call and adapts snake_case API payloads to the camelCase types in `types.ts`.
- `components/` — feature panels (`MapView`, `LayerPanel`, `ReportsWorkspace`, `ReportPanel`, `ConsumptionDropsPanel`, `InspectorDrawer`, `LoginPage`, `Ribbon`) plus `components/ui/` (shadcn-derived primitives on `@base-ui/react`).
- `features/indicators/` — an MDI (multi-document interface) workspace for indicator views: `mdiState.ts`/`mdiContext.ts` hold the window layout state machine, `MdiProvider.tsx`/`MdiWorkspace.tsx` render it, `indicatorCatalog.ts` defines the available indicators.
- `features/map/lotContext.ts` — shared state for the currently-selected cadastral lot/block, used by both the map and the inspector drawer.
- Heavy panels (`MapView`, `ReportPanel`) are lazy-loaded (`React.lazy`) from `App.tsx`.
- Path alias `@` → `src/` (see `vite.config.ts`).

## Key conventions

- TypeScript/React: PascalCase components, `use`-prefixed camelCase hooks, Tailwind for styling.
- Python: snake_case modules/functions, PascalCase classes, settings via `pydantic-settings` (`app/config.py`).
- Rust: snake_case modules/functions, PascalCase types; comments in this codebase are written in Spanish and are reserved for non-obvious security/behavioral rationale (see `lib.rs`) — match that style rather than adding routine doc comments.
- Vite dev server is pinned to `127.0.0.1:1420` (not the Vite default) because `tauri.conf.json`'s `devUrl` and the app's CSP `connect-src` hardcode that origin.
