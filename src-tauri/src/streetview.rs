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

fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn ollama_host() -> String {
    env_non_empty("OLLAMA_HOST").unwrap_or_else(|| DEFAULT_OLLAMA_HOST.to_string())
}

fn ollama_model() -> String {
    env_non_empty("OLLAMA_MODEL").unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string())
}

fn ollama_api_key() -> Option<String> {
    env_non_empty("OLLAMA_API_KEY")
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
        Ok(result) => FloorAnalysisEvent {
            lat: position.lat,
            lng: position.lng,
            heading: position.heading,
            floors: result.floors,
            confidence: result.confidence.clone(),
            color_hex: result.color_hex.clone(),
            note: result.note.clone(),
            error: None,
            lot_id: lot_id.clone(),
        },
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
                lot_id: lot_id.clone(),
            }
        }
    };
    let _ = app.emit("streetview:floor-analysis", event);

    if let Ok(result) = outcome {
        persist_estimate(&app, lot_id, result).await;
    }
}

/// Actualiza `gis_lots.levels` con los pisos visibles detectados por IA y guarda
/// además la misma estimación en `estimated_levels` junto con su confianza y
/// origen. El color se conserva en `color_hex`. Sólo se persiste si Street View
/// se abrió desde un lote conocido (`start_tracking` recibió un `lot_id`).
async fn persist_estimate(app: &AppHandle, lot_id: Option<String>, result: FloorAnalysisResult) {
    let floors = result.floors;
    let confidence = result
        .confidence
        .as_deref()
        .and_then(confidence_to_backend_enum);
    let color_hex = result.color_hex.as_deref();
    if floors.is_none() && color_hex.is_none() {
        return;
    }
    if floors.is_some() && confidence.is_none() {
        return;
    }
    let Some(lot_id) = lot_id else {
        return;
    };
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };

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
        }
        Err(err) => {
            eprintln!("[streetview] no se pudo guardar la estimación en el lote {lot_id}: {err:?}");
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
        _ => None,
    }
}

struct FloorAnalysisResult {
    floors: Option<u32>,
    confidence: Option<String>,
    color_hex: Option<String>,
    note: Option<String>,
}

async fn capture_and_analyze(
    app: &AppHandle,
    runtime: &StreetviewRuntime,
    position: &StreetviewPosition,
) -> Result<FloorAnalysisResult, AppError> {
    let api_key = ollama_api_key().ok_or(AppError::OllamaNotConfigured)?;
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

    analyze_with_ollama(&runtime.ollama_client, &api_key, &jpeg_bytes, position).await
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
struct OllamaChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaChatMessage,
}

#[derive(Debug, Deserialize, Default)]
struct FloorAnalysisPayload {
    pisos: Option<u32>,
    confianza: Option<String>,
    color_hex: Option<String>,
    nota: Option<String>,
}

async fn analyze_with_ollama(
    client: &reqwest::Client,
    api_key: &str,
    image_bytes: &[u8],
    position: &StreetviewPosition,
) -> Result<FloorAnalysisResult, AppError> {
    let encoded = BASE64_STANDARD.encode(image_bytes);
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

    let body = serde_json::json!({
        "model": ollama_model(),
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [encoded],
        }],
        "stream": false,
        "format": "json",
    });

    let url = format!("{}/api/chat", ollama_host().trim_end_matches('/'));
    let response = client
        .post(url)
        .bearer_auth(api_key)
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
    // `unwrap_or_default()` acá escondería un JSON mal formado detrás de un
    // inocuo "no se pudo determinar" -- mejor tratarlo como error explícito,
    // con el contenido crudo del modelo, para poder ajustar el prompt.
    let payload: FloorAnalysisPayload =
        serde_json::from_str(extract_json_object(&parsed.message.content)).map_err(|err| {
            let snippet: String = parsed.message.content.chars().take(300).collect();
            AppError::OllamaRequest(format!(
                "respuesta no es el JSON esperado ({err}): {snippet}"
            ))
        })?;

    Ok(FloorAnalysisResult {
        floors: payload.pisos,
        confidence: payload.confianza,
        color_hex: payload.color_hex.as_deref().and_then(normalize_hex_color),
        note: payload.nota,
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
fn extract_json_object(content: &str) -> &str {
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
    fn extracts_json_wrapped_in_markdown_fence() {
        let content =
            "```json\n{\"pisos\": 3, \"confianza\": \"alta\", \"nota\": \"tres niveles\"}\n```";
        let payload: FloorAnalysisPayload =
            serde_json::from_str(extract_json_object(content)).unwrap();
        assert_eq!(payload.pisos, Some(3));
        assert_eq!(payload.confianza.as_deref(), Some("alta"));
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
        assert_eq!(confidence_to_backend_enum("no sé"), None);
    }

    #[test]
    fn extract_json_object_passes_through_plain_json() {
        let content = "{\"pisos\": null, \"confianza\": \"baja\", \"nota\": null}";
        assert_eq!(extract_json_object(content), content);
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
