//! Sigue la posición del usuario dentro de la ventana pública de Google Street
//! View (abierta por `open_maps_window`) y dispara un conteo de pisos con
//! Ollama cuando la vista se asienta en un lugar nuevo.
//!
//! No hay forma soportada de leer el DOM/canvas de esa ventana (es el origen
//! real de Google, no algo que la app controle), así que la posición se infiere
//! parseando la URL de Street View (codifica lat/lng/heading/pitch en el path,
//! ej. `.../@-12.03,-77.08,3a,75y,90h,88t/data=...`) y la imagen para Ollama se
//! obtiene con una captura de pantalla real de esa ventana.

use std::io::Cursor;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};
use tokio::sync::Mutex;

use crate::{AppError, AppState};

pub(crate) const MAPS_WINDOW_LABEL: &str = "maps-view";

const DEFAULT_OLLAMA_HOST: &str = "https://ollama.com";
const DEFAULT_OLLAMA_MODEL: &str = "gemma4:31b-cloud";
const POLL_INTERVAL: Duration = Duration::from_millis(700);
const SETTLE_DELAY: Duration = Duration::from_millis(900);
const MAX_CAPTURE_SIDE: u32 = 900;

/// Clave de deduplicación: lat/lng redondeados a ~0.11 m y heading en buckets
/// de 10°, para no reemitir/reanalizar cuando el usuario no se movió en serio.
type PositionKey = (i64, i64, i32);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreetviewPosition {
    pub(crate) lat: f64,
    pub(crate) lng: f64,
    pub(crate) heading: Option<f64>,
    pub(crate) pitch: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloorAnalysisEvent {
    lat: f64,
    lng: f64,
    heading: Option<f64>,
    floors: Option<u32>,
    confidence: Option<String>,
    color_hex: Option<String>,
    note: Option<String>,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persisted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persist_error: Option<String>,
    /// Lote catastral activo (ver `StreetviewRuntime::lot_id`) para que el
    /// frontend pueda previsualizar la extrusión 3D al instante, sin esperar
    /// a que se persista en el backend.
    lot_id: Option<String>,
}

pub(crate) struct StreetviewRuntime {
    ollama_client: reqwest::Client,
    poll_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    last_emitted_key: Mutex<Option<PositionKey>>,
    last_analyzed_key: Mutex<Option<PositionKey>>,
    analyzing: Mutex<bool>,
    /// Identifica la sesión de la ventana para descartar análisis que
    /// terminaron después de cerrar/reabrir Street View.
    session_id: AtomicU64,
    /// Lote catastral desde el que se abrió Street View, si lo hay. Sólo se
    /// persiste el análisis de Ollama cuando esto está seteado -- un click en
    /// un punto vacío del mapa no tiene a qué lote asociarle el resultado.
    lot_id: Mutex<Option<String>>,
}

impl StreetviewRuntime {
    pub(crate) fn new() -> Result<Self, AppError> {
        let ollama_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self {
            ollama_client,
            poll_task: Mutex::new(None),
            last_emitted_key: Mutex::new(None),
            last_analyzed_key: Mutex::new(None),
            analyzing: Mutex::new(false),
            session_id: AtomicU64::new(0),
            lot_id: Mutex::new(None),
        })
    }
}

/// Ruta fija donde queda la última captura de Street View mandada a Ollama
/// (ver el comentario en `capture_and_analyze`). Se sobreescribe en cada
/// intento, nunca se acumula.
fn debug_capture_path() -> Option<std::path::PathBuf> {
    Some(std::env::temp_dir().join("sedapalgis-streetview-capture.jpg"))
}

fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn ollama_host() -> String {
    env_non_empty("OLLAMA_HOST").unwrap_or_else(|| DEFAULT_OLLAMA_HOST.to_string())
}

pub(crate) fn ollama_model() -> String {
    env_non_empty("OLLAMA_MODEL").unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string())
}

pub(crate) fn ollama_api_key() -> Option<String> {
    env_non_empty("OLLAMA_API_KEY")
}

// Sin `Debug` a propósito: lleva la API key en claro.
#[derive(Clone)]
pub(crate) struct OllamaRuntimeConfig {
    pub(crate) host: String,
    pub(crate) model: String,
    pub(crate) api_key: String,
}

pub(crate) struct CachedOllamaConfig {
    fetched_at: Instant,
    config: OllamaRuntimeConfig,
}

const OLLAMA_CONFIG_TTL: Duration = Duration::from_secs(600);

fn server_ollama_config(payload: &Value) -> Option<OllamaRuntimeConfig> {
    let non_empty_str = |key: &str| -> Option<String> {
        payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let api_key = non_empty_str("api_key").or_else(ollama_api_key)?;
    Some(OllamaRuntimeConfig {
        host: non_empty_str("host").unwrap_or_else(ollama_host),
        model: non_empty_str("model").unwrap_or_else(ollama_model),
        api_key,
    })
}

/// Olvida la config cacheada (p. ej. Ollama rechazó la clave con 401 porque
/// la rotaron desde la pantalla de fotos): la próxima llamada la relee.
pub(crate) async fn invalidate_ollama_config(state: &AppState) {
    *state.ollama_config.lock().await = None;
}

/// Resuelve host/modelo/API key de Ollama Cloud pidiéndoselos al backend
/// (`GET api/v1/gis/ollama/config`), que los comparte con fotos de
/// medidores y el chatbot (ver `resolve_ollama_api_key` en
/// `sedapal-backend-aws`): cambiar la clave desde la pantalla de
/// configuración de fotos vale también para Street View y la sugerencia de
/// división de lotes, sin tener que tocar el entorno de cada PC.
///
/// Se cachea `OLLAMA_CONFIG_TTL` en memoria: sin caché cada captura pedía la
/// config, y si esa llamada caía en un 429 (rate limit del backend) se
/// degradaba en silencio a la `OLLAMA_API_KEY` local -- vencida en esta PC --
/// y el usuario veía un 401 de Ollama que no tenía nada que ver con la clave
/// real. Si el refresco falla, se reusa la última config buena; solo sin
/// ninguna se degrada al entorno local.
pub(crate) async fn resolve_ollama_config(
    state: &AppState,
) -> Result<OllamaRuntimeConfig, AppError> {
    let mut cached = state.ollama_config.lock().await;
    if let Some(entry) = cached.as_ref() {
        if entry.fetched_at.elapsed() < OLLAMA_CONFIG_TTL {
            return Ok(entry.config.clone());
        }
    }
    match state
        .authenticated_get("api/v1/gis/ollama/config", &[])
        .await
    {
        Ok(payload) => {
            if let Some(config) = server_ollama_config(&payload) {
                *cached = Some(CachedOllamaConfig {
                    fetched_at: Instant::now(),
                    config: config.clone(),
                });
                return Ok(config);
            }
        }
        Err(err) => {
            if let Some(entry) = cached.as_ref() {
                eprintln!("[ollama] no se pudo refrescar la config del servidor ({err}); se reusa la última");
                return Ok(entry.config.clone());
            }
            eprintln!("[ollama] no se pudo leer la config del servidor ({err}); se usa OLLAMA_API_KEY local");
        }
    }
    drop(cached);
    let api_key = ollama_api_key().ok_or(AppError::OllamaNotConfigured)?;
    Ok(OllamaRuntimeConfig {
        host: ollama_host(),
        model: ollama_model(),
        api_key,
    })
}

/// Parsea el segmento `/@lat,lng,...` de una URL de Google Maps.
///
/// Formato no oficial y no documentado por Google: si lo cambian, esto deja de
/// reconocer heading/pitch (degrada a solo lat/lng, o directamente no emite)
/// en vez de romper la app.
fn parse_streetview_url(url: &str) -> Option<(StreetviewPosition, bool)> {
    let at_index = url.find("/@")?;
    let rest = &url[at_index + 2..];
    let end = rest.find(['/', '?']).unwrap_or(rest.len());
    let segment = &rest[..end];

    let mut lat = None;
    let mut lng = None;
    let mut heading = None;
    let mut pitch = None;
    let mut is_panorama = false;
    let mut plain_index = 0u8;

    for token in segment.split(',') {
        let token = token.trim();
        if token == "3a" {
            is_panorama = true;
            continue;
        }
        if let Some(value) = token.strip_suffix('h') {
            heading = value.parse::<f64>().ok();
            continue;
        }
        if let Some(value) = token.strip_suffix('t') {
            pitch = value.parse::<f64>().ok();
            continue;
        }
        if token.ends_with('y') || token.ends_with('z') {
            continue;
        }
        match plain_index {
            0 => lat = token.parse::<f64>().ok(),
            1 => lng = token.parse::<f64>().ok(),
            _ => {}
        }
        plain_index += 1;
    }

    if !is_panorama && url.contains("!1e1") {
        is_panorama = true;
    }

    let lat = lat.filter(|value| value.is_finite())?;
    let lng = lng.filter(|value| value.is_finite())?;

    Some((
        StreetviewPosition {
            lat,
            lng,
            heading,
            pitch,
        },
        is_panorama,
    ))
}

fn position_key(position: &StreetviewPosition) -> PositionKey {
    let lat = (position.lat * 1_000_000.0).round() as i64;
    let lng = (position.lng * 1_000_000.0).round() as i64;
    let heading_bucket = position
        .heading
        .map(|value| (value.rem_euclid(360.0) / 10.0).round() as i32)
        .unwrap_or(-1);
    (lat, lng, heading_bucket)
}

/// Engancha el cierre de la ventana de maps para frenar el sondeo. Se llama
/// una sola vez, justo al crear la ventana (no en cada `open_maps_window`).
pub(crate) fn watch_window_close(
    window: &WebviewWindow,
    app: AppHandle,
    runtime: Arc<StreetviewRuntime>,
) {
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            let app = app.clone();
            let runtime = runtime.clone();
            tauri::async_runtime::spawn(async move {
                stop_tracking(&app, &runtime).await;
            });
        }
    });
}

pub(crate) async fn start_tracking(
    app: AppHandle,
    runtime: Arc<StreetviewRuntime>,
    lot_id: Option<String>,
) {
    stop_tracking(&app, &runtime).await;
    let session_id = runtime.session_id.fetch_add(1, Ordering::SeqCst) + 1;
    *runtime.lot_id.lock().await = lot_id;
    let task_app = app;
    let task_runtime = runtime.clone();
    let handle = tauri::async_runtime::spawn(async move {
        poll_loop(task_app, task_runtime, session_id).await;
    });
    *runtime.poll_task.lock().await = Some(handle);
}

pub(crate) async fn stop_tracking(app: &AppHandle, runtime: &StreetviewRuntime) {
    runtime.session_id.fetch_add(1, Ordering::SeqCst);
    if let Some(handle) = runtime.poll_task.lock().await.take() {
        handle.abort();
    }
    *runtime.last_emitted_key.lock().await = None;
    *runtime.last_analyzed_key.lock().await = None;
    *runtime.analyzing.lock().await = false;
    *runtime.lot_id.lock().await = None;
    let _ = app.emit("streetview:closed", ());
}

pub(crate) async fn set_target_lot(runtime: &StreetviewRuntime, lot_id: Option<String>) {
    *runtime.lot_id.lock().await = lot_id;
}

async fn poll_loop(app: AppHandle, runtime: Arc<StreetviewRuntime>, session_id: u64) {
    let mut last_change = Instant::now();
    let mut pending_key: Option<PositionKey> = None;

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        if runtime.session_id.load(Ordering::SeqCst) != session_id {
            break;
        }

        let Some(window) = app.get_webview_window(MAPS_WINDOW_LABEL) else {
            break;
        };
        let Ok(url) = window.url() else {
            continue;
        };
        let Some((position, is_panorama)) = parse_streetview_url(url.as_str()) else {
            continue;
        };

        let key = position_key(&position);
        let changed = {
            let mut last_emitted = runtime.last_emitted_key.lock().await;
            if last_emitted.as_ref() == Some(&key) {
                false
            } else {
                *last_emitted = Some(key);
                true
            }
        };

        if changed {
            last_change = Instant::now();
            pending_key = Some(key);
            let _ = app.emit("streetview:position", position);
        }

        if !is_panorama || last_change.elapsed() < SETTLE_DELAY {
            continue;
        }
        let Some(current_key) = pending_key else {
            continue;
        };

        let already_analyzed = {
            let last_analyzed = runtime.last_analyzed_key.lock().await;
            last_analyzed.as_ref() == Some(&current_key)
        };
        if already_analyzed {
            continue;
        }

        let mut analyzing = runtime.analyzing.lock().await;
        if *analyzing {
            continue;
        }
        *analyzing = true;
        drop(analyzing);

        *runtime.last_analyzed_key.lock().await = Some(current_key);
        pending_key = None;

        // Se emite antes de arrancar la captura/el pedido a Ollama (que puede
        // tardar hasta el timeout de 60s) para que el frontend muestre de
        // inmediato que está analizando, en vez de dejar el popup congelado.
        let _ = app.emit("streetview:analyzing", position);

        let analysis_app = app.clone();
        let analysis_runtime = runtime.clone();
        let analysis_lot_id = runtime.lot_id.lock().await.clone();
        tauri::async_runtime::spawn(async move {
            run_floor_analysis(
                analysis_app,
                analysis_runtime,
                position,
                session_id,
                analysis_lot_id,
            )
            .await;
        });
    }
}

async fn run_floor_analysis(
    app: AppHandle,
    runtime: Arc<StreetviewRuntime>,
    position: StreetviewPosition,
    session_id: u64,
    lot_id: Option<String>,
) {
    let outcome = capture_and_analyze(&app, &runtime, &position).await;
    if runtime.session_id.load(Ordering::SeqCst) != session_id {
        return;
    }
    *runtime.analyzing.lock().await = false;

    let event = match &outcome {
        Ok(capture) => {
            let result = &capture.result;
            FloorAnalysisEvent {
                lat: position.lat,
                lng: position.lng,
                heading: position.heading,
                floors: result.floors,
                confidence: result.confidence.clone(),
                color_hex: result.color_hex.clone(),
                note: result.note.clone(),
                error: None,
                persisted: None,
                persist_error: None,
                lot_id: lot_id.clone(),
            }
        }
        Err(err) => {
            eprintln!("[streetview] análisis de pisos falló: {err:?}");
            FloorAnalysisEvent {
                lat: position.lat,
                lng: position.lng,
                heading: position.heading,
                floors: None,
                confidence: None,
                color_hex: None,
                note: None,
                error: Some(err.to_string()),
                persisted: None,
                persist_error: None,
                lot_id: lot_id.clone(),
            }
        }
    };
    let _ = app.emit("streetview:floor-analysis", event);

    if let Ok(capture) = outcome {
        let result = &capture.result;
        let persistence = persist_estimate(&app, lot_id.clone(), result).await;
        let persistence_event = FloorAnalysisEvent {
            lat: position.lat,
            lng: position.lng,
            heading: position.heading,
            floors: result.floors,
            confidence: result.confidence.clone(),
            color_hex: result.color_hex.clone(),
            note: result.note.clone(),
            error: None,
            persisted: Some(persistence.is_ok()),
            persist_error: persistence.err(),
            lot_id: lot_id.clone(),
        };
        let _ = app.emit("streetview:floor-analysis", persistence_event);

        // Fachada 2.5D: mejor esfuerzo, nunca bloquea ni rompe el flujo de
        // pisos/color de arriba (Fase 11, fallback). Solo tiene sentido con
        // un lote conocido, igual que `persist_estimate`.
        if let Some(lot_id) = lot_id {
            match analyze_facade(&app, lot_id.clone(), &position, &capture).await {
                Ok(version) => {
                    println!("[FACADE] facade saved lot={lot_id} version={version}");
                    let _ = app.emit(
                        "streetview:facade-ready",
                        serde_json::json!({ "lotId": lot_id, "version": version }),
                    );
                }
                Err(err) => {
                    // No fatal: el frontend simplemente sigue sin fachada
                    // para este lote y usa fill-extrusion (Fase 11).
                    eprintln!("[FACADE] fallback to extrusion (lot={lot_id}): {err:?}");
                }
            }
        }
    }
}

/// Reenvia el analisis de Gemma (crudo) + la misma captura + la posicion de
/// Street View al servicio de fachadas en FastAPI, que calcula el
/// `front_edge` real contra PostGIS, corre el refinamiento OpenCV y
/// persiste `facade.json`. Devuelve la version persistida.
async fn analyze_facade(
    app: &AppHandle,
    lot_id: String,
    position: &StreetviewPosition,
    capture: &CaptureAnalysis,
) -> Result<u64, AppError> {
    let state = app.try_state::<Arc<AppState>>().ok_or_else(|| {
        AppError::Api("No está disponible la sesión del servicio GIS.".to_string())
    })?;

    let body = serde_json::json!({
        "lotId": lot_id,
        "position": {
            "lat": position.lat,
            "lng": position.lng,
            "heading": position.heading,
            "pitch": position.pitch,
        },
        "gemma": capture.result.raw,
        "imageBase64": capture.image_base64,
    });

    let response = state
        .authenticated_post("api/v1/gis/facades/analyze", &body)
        .await?;
    response
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(AppError::InvalidResponse)
}

/// Actualiza `gis_lots.levels` con los pisos visibles detectados por IA y guarda
/// además la misma estimación en `estimated_levels` junto con su confianza y
/// origen. El color se conserva en `color_hex`. Sólo se persiste si Street View
/// se abrió desde un lote conocido (`start_tracking` recibió un `lot_id`).
async fn persist_estimate(
    app: &AppHandle,
    lot_id: Option<String>,
    result: &FloorAnalysisResult,
) -> Result<(), String> {
    let floors = result.floors;
    let mut confidence = result
        .confidence
        .as_deref()
        .and_then(confidence_to_backend_enum);
    if confidence.is_none() && floors.is_some() {
        // Algunos modelos devuelven el enum en inglÃ©s aunque el prompt estÃ©
        // en espaÃ±ol. Conservamos el nivel detectado con confianza media para
        // que no se pierda silenciosamente la actualizaciÃ³n del lote.
        confidence = Some("medium");
    }
    let color_hex = result.color_hex.as_deref();
    if floors.is_none() && color_hex.is_none() {
        return Err("La IA no devolvió pisos ni color utilizable.".to_string());
    }
    if floors.is_some() && confidence.is_none() {
        return Err("La IA devolvió pisos sin una confianza válida.".to_string());
    }
    let lot_id = lot_id.ok_or_else(|| "No se identificó un lote catastral.".to_string())?;
    let state = app
        .try_state::<Arc<AppState>>()
        .ok_or_else(|| "No está disponible la sesión del servicio GIS.".to_string())?;

    let body = serde_json::json!({
        "lotId": lot_id,
        "levels": floors,
        "confidence": confidence,
        "colorHex": color_hex,
        "source": "ollama-streetview",
    });
    match state
        .authenticated_post("api/v1/gis/catastro/analisis-ia", &body)
        .await
    {
        Ok(_) => {
            state.cache.lock().await.clear_gis_layers();
            Ok(())
        }
        Err(err) => {
            eprintln!("[streetview] no se pudo guardar la estimación en el lote {lot_id}: {err:?}");
            Err(format!("No se pudo guardar en el lote: {err}"))
        }
    }
}

/// Ollama responde en español (para el popup); el backend espera el enum
/// `low`|`medium`|`high` de `estimated_levels_confidence`.
fn confidence_to_backend_enum(confidence: &str) -> Option<&'static str> {
    match confidence.trim().to_lowercase().as_str() {
        "alta" => Some("high"),
        "media" => Some("medium"),
        "baja" => Some("low"),
        "high" => Some("high"),
        "medium" => Some("medium"),
        "low" => Some("low"),
        _ => None,
    }
}

struct FloorAnalysisResult {
    floors: Option<u32>,
    confidence: Option<String>,
    color_hex: Option<String>,
    note: Option<String>,
    /// JSON crudo devuelto por Gemma (incluye los campos nuevos de fachada
    /// 2.5D -- `fachada`, `contorno_aproximado`, `ventanas`, `puertas`,
    /// `portones`, `balcones` -- ademas de los 4 compatibles de siempre).
    /// Se reenvia tal cual a `facades/analyze`; este archivo no necesita
    /// tipar cada campo nuevo porque FastAPI valida el payload.
    raw: Value,
}

/// Resultado de una captura+analisis completos: el JSON de Gemma mas la
/// misma imagen en base64 que se le mando, para poder reenviarla al servicio
/// de fachadas sin volver a capturar pantalla.
struct CaptureAnalysis {
    result: FloorAnalysisResult,
    image_base64: String,
}

async fn capture_and_analyze(
    app: &AppHandle,
    runtime: &StreetviewRuntime,
    position: &StreetviewPosition,
) -> Result<CaptureAnalysis, AppError> {
    let state = app.try_state::<Arc<AppState>>().ok_or_else(|| {
        AppError::Api("No está disponible la sesión del servicio GIS.".to_string())
    })?;
    let config = resolve_ollama_config(&state).await?;
    let window = app
        .get_webview_window(MAPS_WINDOW_LABEL)
        .ok_or(AppError::WindowCreation)?;
    let origin = window.outer_position().map_err(|err| {
        AppError::Capture(format!("no se pudo leer la posición de la ventana: {err}"))
    })?;
    let size = window.outer_size().map_err(|err| {
        AppError::Capture(format!("no se pudo leer el tamaño de la ventana: {err}"))
    })?;

    let jpeg_bytes = tauri::async_runtime::spawn_blocking(move || {
        capture_region_jpeg(origin.x, origin.y, size.width, size.height)
    })
    .await
    .map_err(|err| AppError::Capture(format!("tarea de captura interrumpida: {err}")))??;

    // Diagnóstico temporal (ver "captura de la ventana equivocada" reportado
    // en producción): guarda la última captura sin importar el resultado del
    // análisis, para poder confirmar a simple vista si el recorte agarró la
    // ventana de Street View o algo distinto (p.ej. la app detrás). El
    // launcher corre `pnpm tauri dev` con la consola oculta, así que un
    // archivo es más útil acá que `eprintln!`. Best-effort: nunca debe
    // romper el análisis si no se puede escribir.
    if let Some(path) = debug_capture_path() {
        let _ = std::fs::write(&path, &jpeg_bytes);
        eprintln!(
            "[streetview] captura guardada en {path:?} (ventana en x={}, y={}, {}x{})",
            origin.x, origin.y, size.width, size.height
        );
    }

    let image_base64 = BASE64_STANDARD.encode(&jpeg_bytes);
    let result =
        match analyze_with_ollama(&runtime.ollama_client, &config, &image_base64, position).await {
            Err(AppError::OllamaRequest(message)) if message.starts_with("HTTP 401") => {
                invalidate_ollama_config(&state).await;
                return Err(AppError::OllamaRequest(message));
            }
            other => other?,
        };
    Ok(CaptureAnalysis {
        result,
        image_base64,
    })
}

/// Sentinel que Windows reporta como posición de una ventana minimizada
/// (`GetWindowRect`/`outer_position()` devuelven (-32000, -32000)).
const WINDOWS_MINIMIZED_SENTINEL: i32 = -32000;

/// Encuentra el monitor que más se superpone con el rectángulo de la ventana.
///
/// Antes se usaba `xcap::Monitor::from_point()` sobre la esquina superior
/// izquierda de la ventana: `MonitorFromPoint(.., MONITOR_DEFAULTTONULL)`
/// devuelve NULL en cuanto ese único punto no cae dentro de ningún monitor
/// (arreglo multi-monitor con resoluciones distintas, ventana arrastrada a
/// medias fuera de pantalla, o el sentinel de minimizado), lo que hacía
/// fallar la segunda captura aunque la primera -- con la ventana recién
/// posicionada -- funcionara. Superponer el rectángulo completo contra todos
/// los monitores y quedarse con el de mayor área en común es tolerante a
/// esos casos de borde.
fn find_monitor_for_window(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<xcap::Monitor, AppError> {
    if x <= WINDOWS_MINIMIZED_SENTINEL || y <= WINDOWS_MINIMIZED_SENTINEL {
        return Err(AppError::Capture(
            "la ventana de Street View está minimizada".to_string(),
        ));
    }

    let monitors = xcap::Monitor::all()
        .map_err(|err| AppError::Capture(format!("no se pudo listar los monitores: {err}")))?;

    let window_right = x as i64 + width as i64;
    let window_bottom = y as i64 + height as i64;

    let mut best: Option<(i64, xcap::Monitor)> = None;
    for monitor in monitors {
        let (Ok(monitor_x), Ok(monitor_y), Ok(monitor_width), Ok(monitor_height)) =
            (monitor.x(), monitor.y(), monitor.width(), monitor.height())
        else {
            continue;
        };
        let overlap_width = (window_right.min(monitor_x as i64 + monitor_width as i64)
            - (x as i64).max(monitor_x as i64))
        .max(0);
        let overlap_height = (window_bottom.min(monitor_y as i64 + monitor_height as i64)
            - (y as i64).max(monitor_y as i64))
        .max(0);
        let overlap = overlap_width * overlap_height;
        if best.as_ref().is_none_or(|(area, _)| overlap > *area) {
            best = Some((overlap, monitor));
        }
    }

    best.map(|(_, monitor)| monitor)
        .ok_or_else(|| AppError::Capture("no se encontró el monitor de la ventana".to_string()))
}

/// Bloqueante a propósito (llamada desde `spawn_blocking`): tanto la captura
/// de `xcap` como la codificación JPEG son operaciones de CPU/IO sincrónicas.
///
/// El detalle de cada error viaja dentro de `AppError::Capture` (no solo a
/// `eprintln!`) porque el launcher del usuario corre `pnpm tauri dev` en una
/// consola oculta (`-WindowStyle Hidden`): el popup del frontend es lo único
/// que puede llegar a ver.
///
/// No se puede usar `xcap::Window` para capturar la ventana de Street View
/// directamente: `xcap` descarta a propósito cualquier ventana del *mismo
/// proceso* que lo llama (evita un deadlock documentado de `GetWindowText`),
/// y esa ventana vive en el mismo `sedapalgis.exe`. La alternativa es capturar
/// el monitor completo (`xcap::Monitor`, que no filtra por proceso) y recortar
/// por la posición/tamaño de la ventana, que sí nos da Tauri directamente.
fn capture_region_jpeg(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, AppError> {
    if width == 0 || height == 0 {
        return Err(AppError::Capture(
            "la ventana de Street View tiene tamaño cero (¿está minimizada?)".to_string(),
        ));
    }

    let monitor = find_monitor_for_window(x, y, width, height)?;
    let monitor_x = monitor.x().map_err(|err| {
        AppError::Capture(format!("no se pudo leer la posición del monitor: {err}"))
    })?;
    let monitor_y = monitor.y().map_err(|err| {
        AppError::Capture(format!("no se pudo leer la posición del monitor: {err}"))
    })?;
    let monitor_width = monitor
        .width()
        .map_err(|err| AppError::Capture(format!("no se pudo leer el ancho del monitor: {err}")))?;
    let monitor_height = monitor
        .height()
        .map_err(|err| AppError::Capture(format!("no se pudo leer el alto del monitor: {err}")))?;

    let region_x = (x - monitor_x).max(0) as u32;
    let region_y = (y - monitor_y).max(0) as u32;
    let region_width = width.min(monitor_width.saturating_sub(region_x));
    let region_height = height.min(monitor_height.saturating_sub(region_y));
    if region_width == 0 || region_height == 0 {
        return Err(AppError::Capture(format!(
            "la región de captura quedó vacía tras ajustarla al monitor ({monitor_width}x{monitor_height})",
        )));
    }

    let rgba = monitor
        .capture_region(region_x, region_y, region_width, region_height)
        .map_err(|err| AppError::Capture(format!("capture_region() falló: {err}")))?;
    let image = DynamicImage::ImageRgba8(rgba);
    let (width, height) = (image.width(), image.height());
    let longest = width.max(height).max(1) as f64;
    let scale = (MAX_CAPTURE_SIDE as f64 / longest).min(1.0);
    let resized = if scale < 1.0 {
        image.resize(
            ((width as f64) * scale).round() as u32,
            ((height as f64) * scale).round() as u32,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };

    let mut buffer = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(resized.to_rgb8())
        .write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(|err| AppError::Capture(format!("no se pudo codificar JPEG: {err}")))?;
    Ok(buffer.into_inner())
}

#[derive(Debug, Deserialize)]
pub(crate) struct OllamaChatMessage {
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OllamaChatResponse {
    pub(crate) message: OllamaChatMessage,
}

#[derive(Debug, Deserialize, Default)]
struct FloorAnalysisPayload {
    pisos: Option<u32>,
    confianza: Option<String>,
    color_hex: Option<String>,
    nota: Option<String>,
}

const FLOOR_COUNT_INSTRUCTIONS: &str = "Selecciona primero el objetivo correcto: analiza la construccion mas cercana a la vereda, en primer plano, identificada por su puerta, cochera, fachada y linea de techo. Ignora edificios vecinos altos que aparezcan a los lados o detras, muros medianeros de ladrillo, paredes laterales sin acceso desde la vereda y fondos que sobresalgan por perspectiva. Si la construccion del primer plano tiene una sola linea de techo sobre la planta baja, responde pisos=1 aunque los edificios vecinos sean de varios pisos. Luego cuenta esa fachada de abajo hacia arriba: la planta baja al nivel de la calle siempre cuenta como el primer piso; cada losa, banda de ventanas o habitacion encima cuenta como un piso adicional. Si hay cuatro niveles habitables visibles, responde pisos=4. No cuentes techo, parapeto, tanque, cables, toldo, antena ni terraza sin señales de habitacion. No sumes casas laterales independientes ni confundas puertas con pisos. Ignora controles y textos de Google y explica brevemente en nota que niveles observaste.";

/// Amplia el analisis para la fachada procedural 2.5D (ver
/// `app/sedapalgis/facade_service.py` en el backend). Aditivo a proposito:
/// los 4 campos de siempre (pisos/confianza/color_hex/nota) se piden igual
/// que antes en los dos `format!` previos, para no romper
/// `FloorAnalysisPayload` ni la persistencia existente de `estimated_levels`
/// si el backend de fachadas no esta desplegado todavia.
const FACADE_STRUCTURE_INSTRUCTIONS: &str = "Ademas del JSON anterior, agrega esta informacion adicional sobre la fachada, en el mismo objeto JSON (no la inventes si no la ves: usa null, false o listas vacias antes que adivinar). Agrega \"fachada\": {\"forma\": \"rectangular\"|\"irregular\"|null, \"material\": \"tarrajeado\"|\"ladrillo_expuesto\"|\"piedra\"|\"otro\"|\"desconocido\", \"techo\": \"plano\"|\"inclinado\"|\"desconocido\", \"parapeto\": true|false|null, \"retranqueos\": true|false|null}. Agrega \"contorno_aproximado\": una lista de 4 a 8 puntos [x,y] normalizados entre 0 y 1 (x=horizontal desde la izquierda, y=vertical desde arriba de la imagen) que sigan el borde visible de ESA fachada (no del lote completo, no del cielo, no de la vereda). Agrega \"ventanas\", \"puertas\", \"portones\" y \"balcones\" como listas de objetos {\"x\":0..1,\"y\":0..1,\"width\":0..1,\"height\":0..1} en las mismas coordenadas normalizadas de la imagen, uno por cada elemento que puedas ver con razonable seguridad (lista vacia si no ves ninguno de ese tipo). No calcules medidas fisicas en metros: esas coordenadas son relativas a la imagen, no reales.";

async fn analyze_with_ollama(
    client: &reqwest::Client,
    config: &OllamaRuntimeConfig,
    image_base64: &str,
    position: &StreetviewPosition,
) -> Result<FloorAnalysisResult, AppError> {
    let prompt = format!(
        "Estás observando una imagen de Google Street View de un predio en Lima, Perú \
(lat {:.6}, lng {:.6}). Contá cuántos pisos o niveles visibles tiene la edificación \
principal que aparece en el centro de la imagen. Respondé ÚNICAMENTE con un JSON \
válido de la forma {{\"pisos\": <entero o null si no se puede determinar>, \"confianza\": \
\"alta\"|\"media\"|\"baja\", \"nota\": \"<explicación breve opcional>\"}}. No agregues \
texto fuera del JSON.",
        position.lat, position.lng
    );
    let prompt = format!(
        "{prompt} Incluye tambiÃ©n \"color_hex\": \"#RRGGBB\" o null, usando el color dominante visible de la fachada o predio y sin inferirlo por contexto. No agregues texto fuera del JSON.",
    );

    let prompt = format!("{prompt} {FLOOR_COUNT_INSTRUCTIONS}");
    let prompt = format!("{prompt} {FACADE_STRUCTURE_INSTRUCTIONS}");

    let body = serde_json::json!({
        "model": config.model,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [image_base64],
        }],
        "stream": false,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "top_p": 0.9,
        },
    });

    let url = format!("{}/api/chat", config.host.trim_end_matches('/'));
    let response = client
        .post(url)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(AppError::Network)?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        let snippet: String = body_text.chars().take(300).collect();
        return Err(AppError::OllamaRequest(format!("HTTP {status}: {snippet}")));
    }

    let parsed: OllamaChatResponse = response.json().await.map_err(AppError::Network)?;
    let json_text = extract_json_object(&parsed.message.content);
    // `unwrap_or_default()` acá escondería un JSON mal formado detrás de un
    // inocuo "no se pudo determinar" -- mejor tratarlo como error explícito,
    // con el contenido crudo del modelo, para poder ajustar el prompt.
    let payload: FloorAnalysisPayload = serde_json::from_str(json_text).map_err(|err| {
        let snippet: String = parsed.message.content.chars().take(300).collect();
        AppError::OllamaRequest(format!(
            "respuesta no es el JSON esperado ({err}): {snippet}"
        ))
    })?;
    // Campos nuevos de fachada (fachada/contorno_aproximado/ventanas/...): se
    // guardan como Value crudo, sin tipar uno por uno en Rust, porque
    // `facades/analyze` en FastAPI es quien valida esa forma y puede
    // evolucionar sin requerir un release nuevo de la app de escritorio.
    let raw: Value = serde_json::from_str(json_text).unwrap_or(Value::Null);

    Ok(FloorAnalysisResult {
        floors: payload.pisos,
        confidence: payload.confianza,
        color_hex: payload.color_hex.as_deref().and_then(normalize_hex_color),
        note: payload.nota,
        raw,
    })
}

fn normalize_hex_color(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let value = trimmed.strip_prefix('#').unwrap_or(trimmed);
    if value.len() != 6 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{value}").to_uppercase())
}

/// Los modelos de chat a veces envuelven el JSON pedido en fences de markdown
/// (` ```json {...} ``` `) pese al `"format": "json"`. Se recorta al primer
/// `{` y al último `}` en vez de exigir JSON puro.
pub(crate) fn extract_json_object(content: &str) -> &str {
    let start = content.find('{');
    let end = content.rfind('}');
    match (start, end) {
        (Some(start), Some(end)) if start <= end => &content[start..=end],
        _ => content,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_ollama_config_uses_server_key_host_and_model() {
        let payload = serde_json::json!({
            "host": " https://ollama.example ",
            "model": "gemma-test",
            "api_key": "server-key",
        });
        let config = server_ollama_config(&payload).expect("config del servidor");
        assert_eq!(config.host, "https://ollama.example");
        assert_eq!(config.model, "gemma-test");
        assert_eq!(config.api_key, "server-key");
    }

    #[test]
    fn server_ollama_config_blank_key_is_not_a_server_config() {
        // Sin OLLAMA_API_KEY en el entorno del test, una clave vacía del
        // servidor no debe producir una config con clave vacía.
        if std::env::var("OLLAMA_API_KEY").is_ok() {
            return;
        }
        let payload = serde_json::json!({ "host": null, "model": null, "api_key": "  " });
        assert!(server_ollama_config(&payload).is_none());
    }

    #[test]
    fn extracts_json_wrapped_in_markdown_fence() {
        let content =
            "```json\n{\"pisos\": 3, \"confianza\": \"alta\", \"nota\": \"tres niveles\"}\n```";
        let payload: FloorAnalysisPayload =
            serde_json::from_str(extract_json_object(content)).unwrap();
        assert_eq!(payload.pisos, Some(3));
        assert_eq!(payload.confianza.as_deref(), Some("alta"));
    }

    #[test]
    fn floor_analysis_payload_ignores_unknown_facade_fields_for_forward_compat() {
        // FloorAnalysisPayload solo tipa los 4 campos de siempre; los nuevos
        // de fachada (fachada/contorno_aproximado/ventanas/...) deben
        // ignorarse aca sin romper -- se leen aparte como `Value` crudo.
        let content = r##"{
            "pisos": 2, "confianza": "media", "color_hex": "#AABBCC", "nota": "ok",
            "fachada": {"material": "tarrajeado", "techo": "plano", "parapeto": true},
            "contorno_aproximado": [[0.1, 0.9], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9]],
            "ventanas": [{"x": 0.2, "y": 0.2, "width": 0.1, "height": 0.1, "piso": 2}],
            "puertas": [], "portones": [], "balcones": []
        }"##;
        let payload: FloorAnalysisPayload = serde_json::from_str(content).unwrap();
        assert_eq!(payload.pisos, Some(2));
        assert_eq!(payload.confianza.as_deref(), Some("media"));

        let raw: Value = serde_json::from_str(content).unwrap();
        assert_eq!(raw["fachada"]["material"], "tarrajeado");
        assert_eq!(raw["ventanas"][0]["piso"], 2);
    }

    #[test]
    fn floor_analysis_payload_defaults_are_none_when_facade_fields_are_the_only_ones_present() {
        // Respuesta minima (modelo viejo o degradado): ni siquiera pisos.
        // FloorAnalysisPayload no debe fallar, solo quedar en None/default.
        let content = r#"{"fachada": {"material": "desconocido"}}"#;
        let payload: FloorAnalysisPayload = serde_json::from_str(content).unwrap();
        assert_eq!(payload.pisos, None);
        assert_eq!(payload.color_hex, None);
    }

    #[test]
    fn facade_structure_instructions_ask_for_normalized_elements_without_inventing() {
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("contorno_aproximado"));
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("ventanas"));
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("puertas"));
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("portones"));
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("balcones"));
        assert!(FACADE_STRUCTURE_INSTRUCTIONS.contains("no la inventes"));
    }

    #[test]
    fn normalizes_valid_hex_colors_and_rejects_invalid_values() {
        assert_eq!(
            normalize_hex_color(" #c47a3a "),
            Some("#C47A3A".to_string())
        );
        assert_eq!(normalize_hex_color("red"), None);
        assert_eq!(normalize_hex_color("#12345"), None);
    }

    #[test]
    fn maps_spanish_confidence_to_backend_enum() {
        assert_eq!(confidence_to_backend_enum("alta"), Some("high"));
        assert_eq!(confidence_to_backend_enum("Media"), Some("medium"));
        assert_eq!(confidence_to_backend_enum(" baja "), Some("low"));
        assert_eq!(confidence_to_backend_enum("high"), Some("high"));
        assert_eq!(confidence_to_backend_enum("LOW"), Some("low"));
        assert_eq!(confidence_to_backend_enum("no sé"), None);
    }

    #[test]
    fn extract_json_object_passes_through_plain_json() {
        let content = "{\"pisos\": null, \"confianza\": \"baja\", \"nota\": null}";
        assert_eq!(extract_json_object(content), content);
    }

    #[test]
    fn floor_count_instructions_include_ground_floor_and_fourth_level() {
        assert!(FLOOR_COUNT_INSTRUCTIONS.contains("planta baja al nivel de la calle"));
        assert!(FLOOR_COUNT_INSTRUCTIONS.contains("responde pisos=4"));
        assert!(FLOOR_COUNT_INSTRUCTIONS.contains("No sumes casas laterales"));
        assert!(FLOOR_COUNT_INSTRUCTIONS.contains("construccion mas cercana a la vereda"));
        assert!(FLOOR_COUNT_INSTRUCTIONS.contains("responde pisos=1"));
    }

    #[test]
    fn parses_full_streetview_url() {
        let url = "https://www.google.com/maps/@-12.026138,-77.086680,3a,75y,90.5h,88.2t/data=!3m6!1e1!3m4!1sAF1QipM!2e0!7i16384!8i8192";
        let (position, is_panorama) = parse_streetview_url(url).expect("debe parsear");
        assert!(is_panorama);
        assert!((position.lat - (-12.026138)).abs() < 1e-6);
        assert!((position.lng - (-77.086680)).abs() < 1e-6);
        assert_eq!(position.heading, Some(90.5));
        assert_eq!(position.pitch, Some(88.2));
    }

    #[test]
    fn parses_plain_map_url_without_heading() {
        let url = "https://www.google.com/maps/@-12.026138,-77.086680,17z";
        let (position, is_panorama) = parse_streetview_url(url).expect("debe parsear");
        assert!(!is_panorama);
        assert_eq!(position.heading, None);
        assert_eq!(position.pitch, None);
    }

    #[test]
    fn rejects_url_without_at_segment() {
        assert!(
            parse_streetview_url("https://www.google.com/maps/search/?api=1&query=1,2").is_none()
        );
    }

    #[test]
    fn dedupe_key_buckets_heading() {
        let a = StreetviewPosition {
            lat: -12.026138,
            lng: -77.086680,
            heading: Some(91.0),
            pitch: None,
        };
        let b = StreetviewPosition {
            lat: -12.026138,
            lng: -77.086680,
            heading: Some(94.0),
            pitch: None,
        };
        assert_eq!(position_key(&a), position_key(&b));
    }
}
