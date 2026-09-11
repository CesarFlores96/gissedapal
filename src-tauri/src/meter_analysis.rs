//! Cola local de analisis masivo de fotografias de medidores.
//!
//! El usuario elige una carpeta con el dialogo nativo; cada fotografia se lee
//! del disco, se prepara y se manda a Ollama Cloud desde este proceso. **Las
//! fotos nunca salen hacia el backend**: a Postgres solo viaja el informe de
//! texto ya normalizado por [`crate::meter_normalize`].
//!
//! El modulo es estrictamente de solo lectura sobre la carpeta elegida: no
//! renombra, no mueve y no borra ningun archivo.
//!
//! Cancelacion: se sigue el patron de `streetview.rs` -- un contador de
//! generacion que se incrementa para invalidar; los workers guardan sus lotes
//! ya terminados antes de salir.
//! Cada worker revalida la generacion antes de tomar un archivo y otra vez
//! antes de publicar, para que un resultado tardio de una corrida cancelada no
//! contamine la siguiente.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageDecoder, ImageReader};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::{
    meter_normalize::{self, Adjustment, MeterReport, RawReport},
    streetview::{extract_json_object, OllamaChatResponse},
    AppError, AppState,
};

const API_BASE: &str = "api/v1/fotos-medidores";

/// Extensiones aceptadas. `webp` esta habilitado en el crate `image` con la
/// feature homonima; anunciar una extension que el decoder no soporta seria
/// prometer un analisis que siempre falla.
const SUPPORTED_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

/// Tope por archivo. Una foto de campo ronda los 2-6 MB; 24 MB deja margen de
/// sobra y frena un archivo absurdo antes de intentar decodificarlo.
const MAX_PHOTO_BYTES: u64 = 24 * 1024 * 1024;

/// Tope de pixeles antes de decodificar. `image` devuelve `Result` en casi todo
/// el camino, pero una imagen de 200 MP puede reventar la asignacion de
/// memoria, y con `panic = "abort"` en release eso se lleva la aplicacion
/// entera y la corrida en curso.
const MAX_PIXELS: u64 = 80_000_000;

/// Reintentos ante un límite de tasa de Ollama antes de dar la foto por
/// fallida. Tres cubren un pico transitorio sin dejar la cola colgada.
const MAX_RATE_LIMIT_RETRIES: u32 = 3;

/// Cada cuantos resultados se persiste. Guardar solo al final significa perder
/// horas de analisis si el backend se cae en la foto 890.
const PERSIST_BATCH: usize = 10;

// ---------------------------------------------------------------------------
// Escaneo de carpeta
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedFile {
    pub(crate) file_name: String,
    pub(crate) file_path: String,
    pub(crate) size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkippedFile {
    pub(crate) file_name: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResult {
    pub(crate) folder: String,
    pub(crate) files: Vec<ScannedFile>,
    pub(crate) skipped: Vec<SkippedFile>,
}

/// Decide si un archivo entra a la cola. Pura y testeable: es la que hace que
/// el conteo mostrado antes de arrancar sea honesto.
pub(crate) fn classify_scanned_file(name: &str, size: u64) -> Result<(), String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Formato no compatible (.{extension})"));
    }
    if size == 0 {
        return Err("El archivo está vacío".to_string());
    }
    if size > MAX_PHOTO_BYTES {
        return Err(format!(
            "Supera el máximo de {} MB",
            MAX_PHOTO_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

/// Recorre la carpeta sin seguir symlinks y sin escribir nada.
pub(crate) fn scan_folder(folder: &Path, include_subfolders: bool) -> Result<ScanResult, AppError> {
    let mut files = Vec::new();
    let mut skipped = Vec::new();

    let mut consider = |path: &Path| {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return;
        };
        let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        match classify_scanned_file(name, size) {
            Ok(()) => files.push(ScannedFile {
                file_name: name.to_string(),
                file_path: path.to_string_lossy().to_string(),
                size_bytes: size,
            }),
            Err(reason) => skipped.push(SkippedFile {
                file_name: name.to_string(),
                reason,
            }),
        }
    };

    if include_subfolders {
        for entry in walkdir::WalkDir::new(folder).follow_links(false) {
            let entry = entry.map_err(|err| AppError::PhotoFolder(err.to_string()))?;
            if entry.file_type().is_file() {
                consider(entry.path());
            }
        }
    } else {
        let entries =
            std::fs::read_dir(folder).map_err(|err| AppError::PhotoFolder(err.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|err| AppError::PhotoFolder(err.to_string()))?;
            if entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
            {
                consider(&entry.path());
            }
        }
    }

    files.sort_by(|a, b| {
        a.file_name
            .cmp(&b.file_name)
            .then(a.file_path.cmp(&b.file_path))
    });
    skipped.sort_by(|a, b| a.file_name.cmp(&b.file_name));

    Ok(ScanResult {
        folder: folder.to_string_lossy().to_string(),
        files,
        skipped,
    })
}

/// ¿La ruta pedida cae dentro de alguna carpeta que el usuario eligio?
///
/// Se compara con [`Path::starts_with`], que compara **componentes**. Usar
/// `str::starts_with` dejaria pasar `C:\fotos-secretas` contra la raiz
/// `C:\fotos`, que es exactamente la clase de bug que convierte esto en una
/// primitiva de lectura de archivos arbitrarios.
pub(crate) fn path_is_allowed(candidate: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| candidate.starts_with(root))
}

// ---------------------------------------------------------------------------
// Preparacion de imagen
// ---------------------------------------------------------------------------

/// Lee, corrige orientacion, reescala y codifica a JPEG base64.
///
/// La correccion de orientacion EXIF no es opcional: las fotos de campo salen
/// en vertical con el tag puesto, y sin `apply_orientation` el modelo recibe el
/// medidor de costado. El modo de fallo no es un error visible sino una lectura
/// equivocada que parece plausible.
pub(crate) fn prepare_image(path: &Path, max_side: u32, quality: u8) -> Result<String, AppError> {
    let size = std::fs::metadata(path)
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?
        .len();
    classify_scanned_file(path.to_string_lossy().as_ref(), size).map_err(AppError::PhotoDecode)?;
    let bytes = std::fs::read(path).map_err(|err| AppError::PhotoDecode(err.to_string()))?;

    let reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?;

    let (width, height) = reader
        .into_dimensions()
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?;
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(AppError::PhotoDecode(format!(
            "la imagen tiene {width}x{height} píxeles y supera el máximo admitido"
        )));
    }

    let mut decoder = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?
        .into_decoder()
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?;
    decoded.apply_orientation(orientation);

    let longest = decoded.width().max(decoded.height());
    let resized = if longest > max_side && longest > 0 {
        let scale = f64::from(max_side) / f64::from(longest);
        let target_w = ((f64::from(decoded.width()) * scale).round() as u32).max(1);
        let target_h = ((f64::from(decoded.height()) * scale).round() as u32).max(1);
        decoded.resize(target_w, target_h, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };

    let mut buffer = Cursor::new(Vec::new());
    let rgb = DynamicImage::ImageRgb8(resized.to_rgb8());
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality.clamp(40, 100));
    encoder
        .encode_image(&rgb)
        .map_err(|err| AppError::PhotoDecode(format!("no se pudo codificar JPEG: {err}")))?;
    drop(encoder);

    Ok(BASE64_STANDARD.encode(buffer.into_inner()))
}

// ---------------------------------------------------------------------------
// Configuracion de la corrida
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct RunSettings {
    pub(crate) host: String,
    pub(crate) model: String,
    pub(crate) temperature: f64,
    pub(crate) timeout_seconds: u64,
    pub(crate) concurrency: usize,
    pub(crate) max_image_side: u32,
    pub(crate) jpeg_quality: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedConfig {
    pub(crate) settings: RunSettings,
    pub(crate) prompt: String,
    pub(crate) prompt_template_id: Option<String>,
    pub(crate) prompt_version: Option<i64>,
    pub(crate) api_key: String,
}

fn as_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Trae la configuracion completa y descifra la API key.
///
/// Se resuelve una sola vez por corrida: el prompt, las etiquetas y las reglas
/// quedan congelados, porque si alguien los edita a mitad de cola la version
/// registrada en la ejecucion tiene que seguir siendo cierta.
pub(crate) async fn resolve_config(state: &AppState) -> Result<ResolvedConfig, AppError> {
    resolve_config_with_prompt(state, None).await
}

pub(crate) async fn resolve_config_with_prompt(
    state: &AppState,
    prompt_override: Option<&str>,
) -> Result<ResolvedConfig, AppError> {
    let payload = state
        .authenticated_get(&format!("{API_BASE}/config"), &[])
        .await?;

    let ollama = payload.get("ollama").cloned().unwrap_or(Value::Null);
    let host = as_str(&ollama, "host").unwrap_or_else(|| "https://ollama.com".to_string());
    validate_ollama_host(&host)?;
    let model = as_str(&ollama, "model").unwrap_or_else(|| "gemma4:31b-cloud".to_string());

    // La clave llega ya descifrada por el backend, que la guarda cifrada con una
    // clave maestra propia. Se resuelve una sola vez por corrida y vive solo en
    // memoria: nunca se persiste en esta PC ni se devuelve al webview.
    let api_key = as_str(&ollama, "api_key").ok_or(AppError::OllamaNotConfigured)?;

    let labels: Vec<String> = payload
        .get("labels")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = as_str(item, "name")?;
                    Some(match as_str(item, "description") {
                        Some(description) => format!("{name}: {description}"),
                        None => name,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let rules: Vec<String> = payload
        .get("rules")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| as_str(item, "content"))
                .collect()
        })
        .unwrap_or_default();

    let active_prompt = payload.get("activePrompt").cloned().unwrap_or(Value::Null);
    let body = prompt_override
        .map(str::to_string)
        .or_else(|| as_str(&active_prompt, "body"))
        .ok_or_else(|| {
            AppError::Api("No hay un prompt activo configurado para el análisis.".to_string())
        })?;

    Ok(ResolvedConfig {
        settings: RunSettings {
            host,
            model,
            temperature: ollama
                .get("temperature")
                .and_then(Value::as_f64)
                .unwrap_or(0.1),
            timeout_seconds: ollama
                .get("timeout_seconds")
                .and_then(Value::as_u64)
                .unwrap_or(120),
            concurrency: ollama
                .get("concurrency")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 8) as usize,
            max_image_side: ollama
                .get("max_image_side")
                .and_then(Value::as_u64)
                .unwrap_or(1400)
                .clamp(512, 3000) as u32,
            jpeg_quality: ollama
                .get("jpeg_quality")
                .and_then(Value::as_u64)
                .unwrap_or(85)
                .clamp(40, 100) as u8,
        },
        prompt: meter_normalize::render_prompt(&body, &labels, &rules),
        prompt_template_id: as_str(&active_prompt, "id"),
        prompt_version: active_prompt.get("version").and_then(Value::as_i64),
        api_key,
    })
}

// ---------------------------------------------------------------------------
// Llamada a Ollama
// ---------------------------------------------------------------------------

/// Manda una imagen al modelo y devuelve el informe normalizado.
///
/// Reutiliza el mismo contrato que `streetview::analyze_with_ollama`
/// (`/api/chat` con `stream:false` y `format:"json"`), incluido el rescate de
/// JSON envuelto en fences de markdown.
pub(crate) async fn analyze_image(
    client: &reqwest::Client,
    settings: &RunSettings,
    api_key: &str,
    prompt: &str,
    image_base64: &str,
) -> Result<(MeterReport, Vec<Adjustment>, Value), AppError> {
    validate_ollama_host(&settings.host)?;
    let body = json!({
        "model": settings.model,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [image_base64],
        }],
        "stream": false,
        "format": "json",
        "options": {
            "temperature": settings.temperature,
            "top_p": 0.9,
        },
    });

    let url = format!("{}/api/chat", settings.host.trim_end_matches('/'));

    // Ollama Cloud limita por tasa, y con concurrencia alta sobre un lote
    // grande eso llega seguro. Sin este reintento cada límite se convertiría en
    // una fotografía marcada como error que después hay que reintentar a mano,
    // que es justo lo que no escala en una corrida de decenas de miles.
    let mut intento = 0u32;
    let response = loop {
        let response = client
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .timeout(Duration::from_secs(settings.timeout_seconds))
            .send()
            .await
            .map_err(AppError::Network)?;

        if response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS
            || intento >= MAX_RATE_LIMIT_RETRIES
        {
            break response;
        }

        // Se respeta `retry-after` si viene; si no, una espera creciente. El
        // tope evita que una fotografía bloquee la cola indefinidamente.
        let espera = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(|segundos| segundos.saturating_mul(1000))
            .unwrap_or_else(|| 1000u64.saturating_mul(u64::from(intento) + 1));
        tokio::time::sleep(Duration::from_millis(espera.min(15_000))).await;
        intento += 1;
    };

    if !response.status().is_success() {
        let status = response.status();
        // El cuerpo de la respuesta es lo unico que distingue "clave vencida"
        // de "modelo inexistente" o "sin cuota". Sin el, un 401 obliga a
        // diagnosticar a ciegas.
        let detalle = response.text().await.unwrap_or_default();
        let snippet: String = detalle.chars().take(160).collect();
        let pista = if status == reqwest::StatusCode::UNAUTHORIZED {
            " La clave de IA fue rechazada; avisa al area de sistemas."
        } else {
            " Revisa la configuración y vuelve a intentar."
        };
        return Err(AppError::OllamaRequest(format!(
            "Ollama devolvió HTTP {status}.{pista} {snippet}"
        )));
    }

    let parsed: OllamaChatResponse = response.json().await.map_err(AppError::Network)?;
    let content = extract_json_object(&parsed.message.content);
    let raw: RawReport = serde_json::from_str(content).map_err(|_| {
        AppError::OllamaRequest(
            "La respuesta de Ollama no contiene un informe válido. Reintenta la fotografía.".into(),
        )
    })?;
    let raw_value: Value = serde_json::from_str(content).unwrap_or(Value::Null);

    let (report, adjustments) = meter_normalize::normalize_report(&raw);
    if report.numero_medidor.chars().count() > 255
        || report.lectura.chars().count() > 255
        || [
            &report.estado_conexion,
            &report.estado_medidor,
            &report.observacion,
        ]
        .iter()
        .any(|value| value.chars().count() > 1000)
    {
        return Err(AppError::OllamaRequest(
            "El informe supera la extensión admitida. Reintenta la fotografía.".into(),
        ));
    }
    Ok((report, adjustments, raw_value))
}

pub(crate) fn validate_ollama_host(host: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(host)
        .map_err(|_| AppError::OllamaRequest("Host de Ollama inválido.".into()))?;
    if url.scheme() != "https"
        || url.host_str() != Some("ollama.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(AppError::OllamaRequest(
            "Usa el servicio oficial https://ollama.com.".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Runtime de la cola
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Counters {
    processed: AtomicUsize,
    ok: AtomicUsize,
    review: AtomicUsize,
    error: AtomicUsize,
}

struct ActiveRun {
    generation: u64,
    run_id: String,
    run_token: String,
    files: Arc<Vec<ScannedFile>>,
    cursor: Arc<AtomicUsize>,
    counters: Arc<Counters>,
    prompt: Arc<String>,
    api_key: Arc<String>,
    settings: RunSettings,
    unsaved: Mutex<Vec<Value>>,
    attempts: Mutex<HashMap<String, u32>>,
}

pub(crate) struct MeterAnalysisRuntime {
    ollama_client: reqwest::Client,
    generation: AtomicU64,
    workers: Mutex<Vec<JoinHandle<()>>>,
    active: Mutex<Option<Arc<ActiveRun>>>,
    allowed_roots: Mutex<Vec<PathBuf>>,
    operation: Mutex<()>,
    last_run: Mutex<Option<Arc<ActiveRun>>>,
}

impl MeterAnalysisRuntime {
    pub(crate) fn new() -> Result<Self, AppError> {
        // Timeout amplio en el cliente; cada request ademas fija el suyo segun
        // la configuracion, que es la que manda.
        let ollama_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(600))
            .build()?;
        Ok(Self {
            ollama_client,
            generation: AtomicU64::new(0),
            workers: Mutex::new(Vec::new()),
            active: Mutex::new(None),
            allowed_roots: Mutex::new(Vec::new()),
            operation: Mutex::new(()),
            last_run: Mutex::new(None),
        })
    }

    /// Solo el dialogo nativo alimenta esta lista: es la unica fuente de
    /// autoridad sobre que carpetas puede leer el modulo.
    pub(crate) async fn remember_root(&self, folder: &Path) {
        let canonical = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
        let mut roots = self.allowed_roots.lock().await;
        if !roots.contains(&canonical) {
            roots.push(canonical);
        }
    }

    pub(crate) async fn ensure_allowed(&self, candidate: &Path) -> Result<PathBuf, AppError> {
        let canonical = std::fs::canonicalize(candidate).map_err(|_| AppError::PathNotAllowed)?;
        let roots = self.allowed_roots.lock().await;
        if path_is_allowed(&canonical, &roots) {
            Ok(canonical)
        } else {
            Err(AppError::PathNotAllowed)
        }
    }

    pub(crate) async fn is_busy(&self) -> bool {
        self.active.lock().await.is_some()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    run_token: String,
    processed: usize,
    pending: usize,
    ok: usize,
    review: usize,
    error: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDonePayload {
    run_token: String,
    index: usize,
    file_name: String,
    file_path: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    report: Option<MeterReport>,
    adjustments: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
    duration_ms: u64,
}

/// Lo que se persiste y lo que se emite, en una sola pieza.
struct FileOutcome {
    payload: FileDonePayload,
    record: Value,
    requires_review: bool,
    failed: bool,
}

fn build_record(file: &ScannedFile, payload: &FileDonePayload, raw: Option<&Value>) -> Value {
    json!({
        "fileName": file.file_name,
        "filePath": file.file_path,
        "fileSizeBytes": file.size_bytes,
        "status": payload.status,
        "numeroMedidor": payload.report.as_ref().map(|r| r.numero_medidor.clone()),
        "lectura": payload.report.as_ref().map(|r| r.lectura.clone()),
        "estadoConexion": payload.report.as_ref().map(|r| r.estado_conexion.clone()),
        "estadoMedidor": payload.report.as_ref().map(|r| r.estado_medidor.clone()),
        "observacion": payload.report.as_ref().map(|r| r.observacion.clone()),
        "requiereRevision": payload.report.as_ref().map(|r| r.requiere_revision).unwrap_or(true),
        "postProcessApplied": payload.adjustments,
        "rawResponse": raw.cloned(),
        "errorMessage": payload.error_message,
        "attemptCount": 1,
        "durationMs": payload.duration_ms,
    })
}

/// Analiza un archivo. Nunca devuelve `Err`: un fallo es un resultado con
/// estado `error`, porque la cola debe continuar y el error debe quedar
/// visible en su fila, no desaparecer.
async fn process_file(
    client: &reqwest::Client,
    run: &ActiveRun,
    index: usize,
    file: &ScannedFile,
) -> FileOutcome {
    let started = Instant::now();
    let path = PathBuf::from(&file.file_path);
    let max_side = run.settings.max_image_side;
    let quality = run.settings.jpeg_quality;

    let prepared =
        tauri::async_runtime::spawn_blocking(move || prepare_image(&path, max_side, quality)).await;

    let image = match prepared {
        Ok(Ok(encoded)) => encoded,
        Ok(Err(err)) => return failure(file, index, run, started, err.to_string()),
        Err(err) => {
            return failure(
                file,
                index,
                run,
                started,
                format!("no se pudo preparar la imagen: {err}"),
            )
        }
    };

    match analyze_image(client, &run.settings, &run.api_key, &run.prompt, &image).await {
        Ok((report, adjustments, raw)) => {
            let requires_review = report.requiere_revision;
            let payload = FileDonePayload {
                run_token: run.run_token.clone(),
                index,
                file_name: file.file_name.clone(),
                file_path: file.file_path.clone(),
                status: "done".to_string(),
                report: Some(report),
                adjustments: adjustments.iter().map(Adjustment::code).collect(),
                error_message: None,
                duration_ms: started.elapsed().as_millis() as u64,
            };
            let record = build_record(file, &payload, Some(&raw));
            FileOutcome {
                payload,
                record,
                requires_review,
                failed: false,
            }
        }
        Err(err) => failure(file, index, run, started, err.to_string()),
    }
}

fn failure(
    file: &ScannedFile,
    index: usize,
    run: &ActiveRun,
    started: Instant,
    message: String,
) -> FileOutcome {
    let payload = FileDonePayload {
        run_token: run.run_token.clone(),
        index,
        file_name: file.file_name.clone(),
        file_path: file.file_path.clone(),
        status: "error".to_string(),
        report: None,
        adjustments: Vec::new(),
        error_message: Some(message),
        duration_ms: started.elapsed().as_millis() as u64,
    };
    let record = build_record(file, &payload, None);
    FileOutcome {
        payload,
        record,
        requires_review: true,
        failed: true,
    }
}

async fn persist_batch(app: &AppHandle, state: &AppState, run: &ActiveRun, batch: Vec<Value>) {
    if batch.is_empty() {
        return;
    }
    let count = batch.len();
    let path = format!("{API_BASE}/ejecuciones/{}/resultados", run.run_id);
    if let Err(err) = state
        .authenticated_post(&path, &json!({ "items": &batch }))
        .await
    {
        run.unsaved.lock().await.extend(batch);
        // La cola sigue: los resultados estan en pantalla. Pero el usuario
        // tiene que enterarse, o el grafo va a quedar silenciosamente
        // incompleto respecto de lo que vio analizarse.
        let _ = app.emit(
            "meter-analysis:persist-failed",
            json!({
                "runToken": run.run_token,
                "count": count,
                "message": err.to_string(),
            }),
        );
    }
}

fn emit_progress(app: &AppHandle, run: &ActiveRun) {
    let processed = run.counters.processed.load(Ordering::SeqCst);
    let _ = app.emit(
        "meter-analysis:progress",
        ProgressPayload {
            run_token: run.run_token.clone(),
            processed,
            pending: run.files.len().saturating_sub(processed),
            ok: run.counters.ok.load(Ordering::SeqCst),
            review: run.counters.review.load(Ordering::SeqCst),
            error: run.counters.error.load(Ordering::SeqCst),
        },
    );
}

async fn worker_loop(
    app: AppHandle,
    state: Arc<AppState>,
    runtime: Arc<MeterAnalysisRuntime>,
    run: Arc<ActiveRun>,
) {
    let mut batch: Vec<Value> = Vec::with_capacity(PERSIST_BATCH);

    loop {
        if runtime.generation.load(Ordering::SeqCst) != run.generation {
            break;
        }
        let index = run.cursor.fetch_add(1, Ordering::SeqCst);
        let Some(file) = run.files.get(index) else {
            break;
        };

        let _ = app.emit(
            "meter-analysis:file-started",
            json!({
                "runToken": run.run_token,
                "index": index,
                "fileName": file.file_name,
            }),
        );

        let outcome = process_file(&runtime.ollama_client, &run, index, file).await;

        // Segunda revalidacion: la corrida pudo cancelarse mientras Ollama
        // respondia. Un resultado de una generacion vieja se descarta.
        if runtime.generation.load(Ordering::SeqCst) != run.generation {
            break;
        }

        run.counters.processed.fetch_add(1, Ordering::SeqCst);
        if outcome.failed {
            run.counters.error.fetch_add(1, Ordering::SeqCst);
        } else if outcome.requires_review {
            run.counters.review.fetch_add(1, Ordering::SeqCst);
        } else {
            run.counters.ok.fetch_add(1, Ordering::SeqCst);
        }

        let _ = app.emit("meter-analysis:file-done", &outcome.payload);
        emit_progress(&app, &run);

        batch.push(outcome.record);
        if batch.len() >= PERSIST_BATCH {
            persist_batch(&app, &state, &run, std::mem::take(&mut batch)).await;
        }
    }

    persist_batch(&app, &state, &run, batch).await;
}

/// Arranca la cola. Devuelve en cuanto los workers estan lanzados.
pub(crate) async fn start_run(
    app: AppHandle,
    state: Arc<AppState>,
    runtime: Arc<MeterAnalysisRuntime>,
    folder: PathBuf,
    files: Vec<ScannedFile>,
    concurrency_override: Option<usize>,
) -> Result<Value, AppError> {
    let _operation = runtime
        .operation
        .try_lock()
        .map_err(|_| AppError::AnalysisBusy)?;
    if runtime.is_busy().await {
        return Err(AppError::AnalysisBusy);
    }
    if let Some(previous) = runtime.last_run.lock().await.as_ref() {
        if !previous.unsaved.lock().await.is_empty() {
            return Err(AppError::Api(
                "Guarda los resultados pendientes antes de iniciar otra ejecución.".into(),
            ));
        }
    }

    // Todo lo que puede fallar ocurre antes de crear la ejecucion: descifrar la
    // key, resolver el prompt. Asi no queda una corrida huerfana en 'running'.
    let config = resolve_config(&state).await?;
    let mut settings = config.settings.clone();
    if let Some(value) = concurrency_override {
        settings.concurrency = value.clamp(1, 8);
    }

    let created = state
        .authenticated_post(
            &format!("{API_BASE}/ejecuciones"),
            &json!({
                "folderPath": folder.to_string_lossy(),
                "machineName": hostname(),
                "totalFiles": files.len(),
                "concurrency": settings.concurrency,
                "promptTemplateId": config.prompt_template_id,
                "promptVersion": config.prompt_version,
                "model": settings.model,
                "host": settings.host,
            }),
        )
        .await?;
    let run_id = created
        .get("id")
        .and_then(Value::as_str)
        .ok_or(AppError::InvalidResponse)?
        .to_string();

    let generation = runtime.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let run_token = format!("{run_id}:{generation}");
    let total = files.len();
    let concurrency = settings.concurrency.min(total.max(1));

    let run = Arc::new(ActiveRun {
        generation,
        run_id: run_id.clone(),
        run_token: run_token.clone(),
        files: Arc::new(files),
        cursor: Arc::new(AtomicUsize::new(0)),
        counters: Arc::new(Counters::default()),
        prompt: Arc::new(config.prompt),
        api_key: Arc::new(config.api_key),
        settings,
        unsaved: Mutex::new(Vec::new()),
        attempts: Mutex::new(HashMap::new()),
    });
    *runtime.active.lock().await = Some(Arc::clone(&run));

    let _ = app.emit(
        "meter-analysis:run-started",
        json!({
            "runId": run_id,
            "runToken": run_token,
            "folder": folder.to_string_lossy(),
            "total": total,
            "concurrency": concurrency,
            "promptVersion": config.prompt_version,
            "files": run.files,
        }),
    );

    let mut handles = Vec::with_capacity(concurrency);
    for _ in 0..concurrency {
        let app_handle = app.clone();
        let state_handle = Arc::clone(&state);
        let runtime_handle = Arc::clone(&runtime);
        let run_handle = Arc::clone(&run);
        handles.push(tauri::async_runtime::spawn(async move {
            worker_loop(app_handle, state_handle, runtime_handle, run_handle).await;
        }));
    }
    *runtime.workers.lock().await = handles;

    // Supervisor: espera a que los workers terminen y cierra la ejecucion.
    let supervisor_app = app.clone();
    let supervisor_state = Arc::clone(&state);
    let supervisor_runtime = Arc::clone(&runtime);
    let supervisor_run = Arc::clone(&run);
    tauri::async_runtime::spawn(async move {
        finish_run(
            supervisor_app,
            supervisor_state,
            supervisor_runtime,
            supervisor_run,
        )
        .await;
    });

    Ok(json!({ "runId": run_id, "runToken": run_token, "total": total }))
}

async fn finish_run(
    app: AppHandle,
    state: Arc<AppState>,
    runtime: Arc<MeterAnalysisRuntime>,
    run: Arc<ActiveRun>,
) {
    let handles = std::mem::take(&mut *runtime.workers.lock().await);
    for handle in handles {
        let _ = handle.await;
    }

    let cancelled = runtime.generation.load(Ordering::SeqCst) != run.generation;
    let processed = run.counters.processed.load(Ordering::SeqCst);
    let ok = run.counters.ok.load(Ordering::SeqCst);
    let review = run.counters.review.load(Ordering::SeqCst);
    let error = run.counters.error.load(Ordering::SeqCst);
    let status = if cancelled { "cancelled" } else { "completed" };

    if let Err(err) = state
        .authenticated_patch(
            &format!("{API_BASE}/ejecuciones/{}", run.run_id),
            &json!({
                "status": status,
                "processedCount": processed,
                "okCount": ok,
                "reviewCount": review,
                "errorCount": error,
            }),
        )
        .await
    {
        let _ = app.emit("meter-analysis:persist-failed", json!({ "runToken": run.run_token, "count": 0, "message": format!("No se pudo cerrar la ejecución: {err}") }));
    }
    *runtime.last_run.lock().await = Some(Arc::clone(&run));

    // Solo se libera el slot si sigue siendo esta corrida la activa: si ya
    // arranco otra, pisar `active` la dejaria invisible para `is_busy`.
    let mut active = runtime.active.lock().await;
    if active
        .as_ref()
        .map(|current| current.generation == run.generation)
        .unwrap_or(false)
    {
        *active = None;
    }
    drop(active);

    let _ = app.emit(
        "meter-analysis:run-finished",
        json!({
            "runToken": run.run_token,
            "runId": run.run_id,
            "status": status,
            "processed": processed,
            "ok": ok,
            "review": review,
            "error": error,
            "cancelled": cancelled,
        }),
    );
}

/// Cancela la cola conservando lo ya obtenido.
pub(crate) async fn cancel_run(runtime: &MeterAnalysisRuntime) {
    if !runtime.is_busy().await {
        return;
    }
    runtime.generation.fetch_add(1, Ordering::SeqCst);
    // Los workers terminan la petición en curso y vacían su lote. Abortarlos
    // aquí perdería los resultados ya mostrados y aún no persistidos.
}

/// Reintenta un archivo suelto que fallo, sin reabrir la cola completa.
pub(crate) async fn retry_file(
    app: AppHandle,
    state: Arc<AppState>,
    runtime: Arc<MeterAnalysisRuntime>,
    run_id: String,
    file: ScannedFile,
) -> Result<(), AppError> {
    let _operation = runtime
        .operation
        .try_lock()
        .map_err(|_| AppError::AnalysisBusy)?;
    if runtime.is_busy().await {
        return Err(AppError::AnalysisBusy);
    }
    let previous = runtime
        .last_run
        .lock()
        .await
        .clone()
        .filter(|run| run.run_id == run_id)
        .ok_or_else(|| {
            AppError::Api("El reintento requiere la ejecución original de esta sesión.".into())
        })?;
    if !previous
        .files
        .iter()
        .any(|item| item.file_path == file.file_path)
    {
        return Err(AppError::PathNotAllowed);
    }
    if !previous.unsaved.lock().await.is_empty() {
        return Err(AppError::Api(
            "Guarda los resultados pendientes antes de reintentar una foto.".into(),
        ));
    }
    let attempt = {
        let mut attempts = previous.attempts.lock().await;
        let value = attempts.entry(file.file_path.clone()).or_insert(1);
        if *value >= 100 {
            return Err(AppError::Api(
                "Se alcanzó el límite de reintentos para esta fotografía.".into(),
            ));
        }
        *value += 1;
        *value
    };
    let run = ActiveRun {
        generation: runtime.generation.load(Ordering::SeqCst),
        run_id: run_id.clone(),
        run_token: format!("retry:{run_id}"),
        files: Arc::new(vec![file.clone()]),
        cursor: Arc::new(AtomicUsize::new(0)),
        counters: Arc::new(Counters::default()),
        prompt: Arc::clone(&previous.prompt),
        api_key: Arc::clone(&previous.api_key),
        settings: previous.settings.clone(),
        unsaved: Mutex::new(Vec::new()),
        attempts: Mutex::new(HashMap::new()),
    };

    let outcome = process_file(&runtime.ollama_client, &run, 0, &file).await;
    let _ = app.emit("meter-analysis:file-done", &outcome.payload);

    // Repetir solo el guardado conserva este número; analizar otra vez lo incrementa.
    let mut record = outcome.record;
    if let Some(object) = record.as_object_mut() {
        object.insert("attemptCount".to_string(), json!(attempt));
    }
    persist_batch(&app, &state, &run, vec![record]).await;
    previous
        .unsaved
        .lock()
        .await
        .extend(std::mem::take(&mut *run.unsaved.lock().await));
    Ok(())
}

pub(crate) async fn retry_persistence(
    app: AppHandle,
    state: Arc<AppState>,
    runtime: Arc<MeterAnalysisRuntime>,
) -> Result<(), AppError> {
    let _operation = runtime
        .operation
        .try_lock()
        .map_err(|_| AppError::AnalysisBusy)?;
    if runtime.is_busy().await {
        return Err(AppError::AnalysisBusy);
    }
    let run = runtime
        .last_run
        .lock()
        .await
        .clone()
        .ok_or(AppError::InvalidResponse)?;
    let records = std::mem::take(&mut *run.unsaved.lock().await);
    for batch in records.chunks(PERSIST_BATCH) {
        persist_batch(&app, &state, &run, batch.to_vec()).await;
    }
    if !run.unsaved.lock().await.is_empty() {
        return Err(AppError::Api(
            "Aún hay resultados sin guardar. Comprueba la conexión y vuelve a intentar.".into(),
        ));
    }
    let cancelled = runtime.generation.load(Ordering::SeqCst) != run.generation;
    state
        .authenticated_patch(
            &format!("{API_BASE}/ejecuciones/{}", run.run_id),
            &json!({ "status": if cancelled { "cancelled" } else { "completed" } }),
        )
        .await?;
    Ok(())
}

fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    #[test]
    fn el_secreto_solo_se_envia_al_host_oficial() {
        assert!(validate_ollama_host("https://ollama.com").is_ok());
        for host in [
            "http://ollama.com",
            "https://ollama.com.evil.test",
            "https://user@ollama.com",
            "https://ollama.com/api",
            "https://ollama.com?key=secret",
        ] {
            assert!(validate_ollama_host(host).is_err());
        }
    }

    #[test]
    fn prepara_la_imagen_sin_modificar_el_original() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("meter-photo-{unique}.png"));
        image::RgbImage::new(100, 200).save(&path).expect("fixture");
        let original = std::fs::read(&path).expect("original");
        let prepared = prepare_image(&path, 50, 85).expect("prepare");
        let bytes = BASE64_STANDARD.decode(prepared).expect("base64");
        let image = image::load_from_memory(&bytes).expect("jpeg");
        assert_eq!((image.width(), image.height()), (25, 50));
        assert_eq!(std::fs::read(&path).expect("unchanged"), original);
        std::fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn acepta_las_extensiones_compatibles() {
        for name in ["foto.jpg", "FOTO.JPEG", "medidor.PNG", "x.webp"] {
            assert!(classify_scanned_file(name, 1024).is_ok(), "rechazo {name}");
        }
    }

    #[test]
    fn descarta_con_motivo_legible() {
        assert!(classify_scanned_file("notas.txt", 10)
            .unwrap_err()
            .contains("no compatible"));
        assert!(classify_scanned_file("foto.jpg", 0)
            .unwrap_err()
            .contains("vacío"));
        assert!(classify_scanned_file("foto.jpg", MAX_PHOTO_BYTES + 1)
            .unwrap_err()
            .contains("máximo"));
        assert!(classify_scanned_file("sin_extension", 10).is_err());
    }

    #[test]
    fn una_ruta_dentro_de_la_raiz_esta_permitida() {
        let roots = vec![PathBuf::from("C:/fotos")];
        assert!(path_is_allowed(
            &PathBuf::from("C:/fotos/medidor.jpg"),
            &roots
        ));
        assert!(path_is_allowed(
            &PathBuf::from("C:/fotos/lote1/medidor.jpg"),
            &roots
        ));
    }

    #[test]
    fn una_carpeta_hermana_con_prefijo_comun_no_esta_permitida() {
        // El bug clasico: `str::starts_with` dejaria pasar esta ruta.
        let roots = vec![PathBuf::from("C:/fotos")];
        assert!(!path_is_allowed(
            &PathBuf::from("C:/fotos-secretas/nomina.jpg"),
            &roots
        ));
    }

    #[test]
    fn una_ruta_fuera_de_toda_raiz_no_esta_permitida() {
        let roots = vec![PathBuf::from("C:/fotos"), PathBuf::from("D:/campo")];
        assert!(!path_is_allowed(
            &PathBuf::from("C:/Windows/win.ini"),
            &roots
        ));
        assert!(!path_is_allowed(
            &PathBuf::from("E:/otro/medidor.jpg"),
            &roots
        ));
    }

    #[test]
    fn la_funcion_pura_no_resuelve_traversal_por_si_sola() {
        // `Path::starts_with` compara componentes literales, asi que
        // "C:/fotos/../secreto.jpg" SI pasa este chequeo. La defensa contra
        // traversal es `std::fs::canonicalize` en `ensure_allowed`, que resuelve
        // ".." y symlinks antes de comparar. Este test fija ese reparto de
        // responsabilidades para que nadie borre el canonicalize creyendo que
        // esta funcion ya lo cubre.
        let roots = vec![PathBuf::from("C:/fotos")];
        assert!(path_is_allowed(
            &PathBuf::from("C:/fotos/../secreto.jpg"),
            &roots
        ));
    }

    #[test]
    fn sin_raices_no_se_permite_nada() {
        assert!(!path_is_allowed(
            &PathBuf::from("C:/fotos/medidor.jpg"),
            &[]
        ));
    }
}
