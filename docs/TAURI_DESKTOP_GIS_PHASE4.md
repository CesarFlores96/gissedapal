# Fase 4: arquitectura Desktop GIS con Tauri

## Estructura objetivo

```text
src-tauri/
  binaries/
    martin-x86_64-pc-windows-msvc.exe
  resources/
    martin.yaml
  src/
    commands/
      lot_context.rs
      mod.rs
    domain/
      lot_context.rs
      mod.rs
    infrastructure/
      database.rs
      martin.rs
      mod.rs
    lib.rs
src/
  features/map/
    localTiles.ts
    lotContext.ts
  components/MapView.tsx
```

Martin es un sidecar de infraestructura. El frontend no puede iniciarlo ni
recibir credenciales PostgreSQL. Rust elige un puerto loopback, inicia el
proceso, espera `GET /health`, conserva su handle y lo termina al cerrar Tauri.

## Dependencias y bundle

```toml
# src-tauri/Cargo.toml
[dependencies]
sqlx = { version = "0.8", default-features = false, features = [
  "runtime-tokio-rustls", "postgres", "uuid", "chrono", "derive"
] }
tauri-plugin-shell = "2"
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

```json
// fragmento de src-tauri/tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost http://127.0.0.1:* https://tile.openstreetmap.org https://server.arcgisonline.com; img-src 'self' asset: http://asset.localhost https://tile.openstreetmap.org https://server.arcgisonline.com data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; script-src 'self'"
    }
  },
  "bundle": {
    "externalBin": ["binaries/martin"],
    "resources": ["resources/martin.yaml"]
  }
}
```

El nombre físico lleva el target triple exigido por Tauri. Para el MSI actual:

```text
src-tauri/binaries/martin-x86_64-pc-windows-msvc.exe
```

La URL PostgreSQL se obtiene del almacén seguro del sistema o de
`SEDAPALGIS_DATABASE_URL` durante desarrollo. Nunca se escribe en
`tauri.conf.json`, archivos del frontend, logs ni argumentos del proceso.

## Configuración Martin

```yaml
# src-tauri/resources/martin.yaml
postgres:
  connection_string: ${MARTIN_DATABASE_URL}
  pool_size: 8
  auto_bounds: skip
  auto_publish:
    tables: false
    functions:
      from_schemas: [mvt]
      source_id_format: "{schema}.{function}"

preferred_encoding: gzip
```

## Ciclo de vida del sidecar

```rust
// src-tauri/src/infrastructure/martin.rs
use std::{
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};
use tokio::sync::Mutex;

pub struct MartinState {
    child: Mutex<Option<CommandChild>>,
    base_url: String,
    healthy: Arc<AtomicBool>,
}

impl MartinState {
    pub async fn start(app: &AppHandle, database_url: &str) -> Result<Self, String> {
        let probe = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "No se pudo reservar un puerto local".to_string())?;
        let port = probe.local_addr().map_err(|_| "Puerto local inválido".to_string())?.port();
        drop(probe);

        let config = app.path()
            .resolve("resources/martin.yaml", tauri::path::BaseDirectory::Resource)
            .map_err(|_| "No se encontró la configuración de tiles".to_string())?;

        let config_path = config.to_string_lossy().into_owned();
        let listen_address = format!("127.0.0.1:{port}");
        let (mut events, child) = app.shell()
            .sidecar("martin")
            .map_err(|_| "No se encontró el servidor de tiles".to_string())?
            .args([
                "--config", &config_path,
                "--listen-addresses", &listen_address,
            ])
            .env("MARTIN_DATABASE_URL", database_url)
            .spawn()
            .map_err(|_| "No se pudo iniciar el servidor de tiles".to_string())?;

        let base_url = format!("http://127.0.0.1:{port}");
        let healthy = Arc::new(AtomicBool::new(false));
        let process_health = Arc::clone(&healthy);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if matches!(event, CommandEvent::Terminated(_)) {
                    process_health.store(false, Ordering::Release);
                    break;
                }
            }
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(1))
            .build()
            .map_err(|_| "No se pudo preparar la verificación local".to_string())?;

        let mut ready = false;
        for _ in 0..40 {
            if client.get(format!("{base_url}/health")).send().await
                .is_ok_and(|response| response.status().is_success()) {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ready {
            let _ = child.kill();
            return Err("El servidor local de tiles no quedó disponible".to_string());
        }
        healthy.store(true, Ordering::Release);

        Ok(Self { child: Mutex::new(Some(child)), base_url, healthy })
    }

    pub fn base_url(&self) -> Result<&str, String> {
        self.healthy.load(Ordering::Acquire)
            .then_some(self.base_url.as_str())
            .ok_or_else(|| "El servidor local de tiles no está disponible".to_string())
    }

    pub async fn stop(&self) {
        if let Some(child) = self.child.lock().await.take() {
            self.healthy.store(false, Ordering::Release);
            let _ = child.kill();
        }
    }
}

#[tauri::command]
pub fn get_tile_server_url(state: tauri::State<'_, MartinState>) -> Result<String, String> {
    state.base_url().map(str::to_owned)
}
```

El puerto es dinámico. Existe una ventana mínima entre liberar el socket de
reserva e iniciar Martin; si el bind falla, el arranque debe reintentarse con un
nuevo puerto. Un puerto fijo simplifica CSP y diagnóstico, pero introduce
colisiones entre instancias y con otros procesos.

## Estado de base de datos

```rust
// src-tauri/src/infrastructure/database.rs
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(6)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}
```

La cuenta PostgreSQL del desktop solo recibe permisos CRUD explícitos sobre
`gis.legal_entities` y `gis.lot_legal_entities`, además de SELECT sobre la vista
de contexto. Martin usa otra cuenta que únicamente puede ejecutar funciones
del esquema `mvt`.

## Tipos del contexto de lote

```rust
// src-tauri/src/domain/lot_context.rs
use chrono::NaiveDate;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LotContext {
    pub lot: LotSummary,
    pub current_holders: Vec<CurrentHolder>,
    pub supplies: Vec<SupplyContext>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LotSummary {
    pub id: Uuid,
    pub lot_code: String,
    pub block_id: Uuid,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CurrentHolder {
    pub legal_entity_id: Uuid,
    pub legal_name: String,
    pub entity_type: String,
    pub relationship_type: String,
    pub valid_from: NaiveDate,
    pub valid_to: Option<NaiveDate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplyContext {
    pub id: Uuid,
    pub supply_code: String,
    pub service_status: String,
    pub connection: Option<ConnectionSummary>,
    pub meters: Vec<MeterSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: Uuid,
    pub asset_code: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterSummary {
    pub id: Uuid,
    pub serial_number: String,
    pub status: String,
}
```

## Tauri command que reemplaza `/context`

```rust
// src-tauri/src/commands/lot_context.rs
use sqlx::{FromRow, PgPool};
use tauri::State;
use uuid::Uuid;

use crate::domain::lot_context::{
    ConnectionSummary, CurrentHolder, LotContext, LotSummary, MeterSummary, SupplyContext,
};

#[derive(FromRow)]
struct SupplyRow {
    supply_id: Uuid,
    supply_code: String,
    service_status: String,
    connection_id: Option<Uuid>,
    connection_code: Option<String>,
    connection_status: Option<String>,
    meter_id: Option<Uuid>,
    meter_serial: Option<String>,
    meter_status: Option<String>,
}

#[tauri::command]
pub async fn get_lot_context(
    pool: State<'_, PgPool>,
    lot_id: String,
) -> Result<LotContext, String> {
    let lot_id = Uuid::parse_str(&lot_id).map_err(|_| "Identificador de lote inválido")?;
    let mut tx = pool.begin().await.map_err(|_| "No se pudo consultar la base de datos")?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx).await
        .map_err(|_| "No se pudo iniciar la consulta")?;

    let lot = sqlx::query_as::<_, LotSummary>(
        "SELECT id, lot_code, block_id FROM gis.lots WHERE id = $1"
    )
    .bind(lot_id)
    .fetch_optional(&mut *tx).await
    .map_err(|_| "No se pudo consultar el lote")?
    .ok_or_else(|| "Lote no encontrado".to_string())?;

    let current_holders = sqlx::query_as::<_, CurrentHolder>(r#"
        SELECT le.id AS legal_entity_id,
               le.legal_name,
               le.entity_type,
               rel.relationship_type,
               rel.valid_from,
               rel.valid_to
        FROM gis.lot_legal_entities rel
        JOIN gis.legal_entities le ON le.id = rel.legal_entity_id
        WHERE rel.lot_id = $1
          AND rel.valid_from <= CURRENT_DATE
          AND (rel.valid_to IS NULL OR rel.valid_to >= CURRENT_DATE)
          AND le.is_active = true
        ORDER BY rel.relationship_type, rel.valid_from DESC, le.legal_name
    "#)
    .bind(lot_id)
    .fetch_all(&mut *tx).await
    .map_err(|_| "No se pudieron consultar los titulares")?;

    let rows = sqlx::query_as::<_, SupplyRow>(r#"
        SELECT s.id AS supply_id,
               s.supply_code,
               s.service_status,
               c.id AS connection_id,
               c.asset_code AS connection_code,
               c.status AS connection_status,
               m.id AS meter_id,
               m.serial_number AS meter_serial,
               m.status AS meter_status
        FROM utility.supplies s
        LEFT JOIN utility.service_connections c ON c.id = s.connection_id
        LEFT JOIN utility.meters m ON m.supply_id = s.id
        WHERE s.lot_id = $1
        ORDER BY s.supply_code, m.installation_date DESC NULLS LAST, m.serial_number
    "#)
    .bind(lot_id)
    .fetch_all(&mut *tx).await
    .map_err(|_| "No se pudieron consultar los suministros")?;

    let mut supplies: Vec<SupplyContext> = Vec::new();
    for row in rows {
        let index = supplies.iter().position(|item| item.id == row.supply_id);
        let supply_index = match index {
            Some(value) => value,
            None => {
                supplies.push(SupplyContext {
                    id: row.supply_id,
                    supply_code: row.supply_code.clone(),
                    service_status: row.service_status.clone(),
                    connection: row.connection_id.map(|id| ConnectionSummary {
                        id,
                        asset_code: row.connection_code.clone().unwrap_or_default(),
                        status: row.connection_status.clone().unwrap_or_default(),
                    }),
                    meters: Vec::new(),
                });
                supplies.len() - 1
            }
        };
        if let (Some(id), Some(serial_number), Some(status)) =
            (row.meter_id, row.meter_serial, row.meter_status)
        {
            supplies[supply_index].meters.push(MeterSummary { id, serial_number, status });
        }
    }

    tx.commit().await.map_err(|_| "No se pudo completar la consulta")?;
    Ok(LotContext { lot, current_holders, supplies })
}
```

El command usa una transacción `REPEATABLE READ, READ ONLY`: lote, titulares,
acometidas y medidores corresponden al mismo snapshot aun si otro usuario edita
las vigencias al mismo tiempo.

## Registro en Tauri

```rust
// fragmento de src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
        let database_url = load_database_url_from_secure_storage()?;
        let pool = tauri::async_runtime::block_on(create_pool(&database_url))?;
        let martin = tauri::async_runtime::block_on(
            MartinState::start(app.handle(), &database_url)
        )?;
        app.manage(pool);
        app.manage(martin);
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        get_tile_server_url,
        get_lot_context,
    ]);
```

En el evento de salida se llama `MartinState::stop()`. La rutina de cierre debe
ser idempotente para cubrir cierre normal, error de ventana y reinicio de la app.

## Cliente TypeScript

```ts
// src/features/map/lotContext.ts
import { invoke } from "@tauri-apps/api/core"

export type LotContext = {
  lot: { id: string; lotCode: string; blockId: string }
  currentHolders: Array<{
    legalEntityId: string
    legalName: string
    entityType: string
    relationshipType: string
    validFrom: string
    validTo: string | null
  }>
  supplies: Array<{
    id: string
    supplyCode: string
    serviceStatus: string
    connection: { id: string; assetCode: string; status: string } | null
    meters: Array<{ id: string; serialNumber: string; status: string }>
  }>
}

export const getTileServerUrl = (): Promise<string> => invoke("get_tile_server_url")
export const getLotContext = (lotId: string): Promise<LotContext> =>
  invoke("get_lot_context", { lotId })
```

```ts
// integración esencial en MapView.tsx, dentro de map.on("load")
const martinUrl = await getTileServerUrl()

map.addSource("local-lots", {
  type: "vector",
  tiles: [`${martinUrl}/mvt.lots/{z}/{x}/{y}`],
  minzoom: 15,
  maxzoom: 22,
  promoteId: "id",
})

map.addLayer({
  id: "lot-fill-mvt",
  type: "fill",
  source: "local-lots",
  "source-layer": "lots",
  minzoom: 15,
  paint: {
    "fill-color": "#d6a756",
    "fill-opacity": 0.16,
    "fill-outline-color": "rgba(255,255,255,0.45)",
  },
})

map.on("click", "lot-fill-mvt", (event) => {
  const lotId = event.features?.[0]?.properties?.id
  if (typeof lotId !== "string") return

  void getLotContext(lotId)
    .then((context) => onLotContext(context))
    .catch(() => onLotContextError("No se pudo consultar el lote"))
})
```

En el mapa actual conviene mantener un único handler global de clic y cambiar
solamente la consulta de `lot-fill` por `lot-fill-mvt`. Así se conserva la
precedencia existente: suministro, lote, manzana y finalmente ubicación vacía.

## Decisiones operativas

- Martin escucha únicamente en `127.0.0.1`; nunca en `0.0.0.0`.
- El frontend recibe solo la URL local. Las credenciales permanecen en Rust.
- Los tiles no contienen titularidad, documentos, NIS ni seriales.
- El UUID `id` de la capa `lots` es el enlace entre MVT y `get_lot_context`.
- Martin y el CRUD usan roles PostgreSQL separados y mínimos.
- Si la base es remota, se exige TLS (`sslmode=verify-full`) y credenciales
  revocables por usuario o equipo; una contraseña global dentro del instalador
  no constituye un límite de seguridad.
