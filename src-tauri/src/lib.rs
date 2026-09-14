use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use keyring::Entry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env, fs,
    net::IpAddr,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;

mod lot_split;
mod meter_analysis;
mod meter_consolidation;
mod meter_excel;
mod meter_normalize;
mod streetview;

pub(crate) const CREDENTIAL_SERVICE: &str = "pe.sedapal.gis";
const CREDENTIAL_USER: &str = "refresh-token";
const CACHE_TTL: Duration = Duration::from_secs(300);
const CACHE_CAPACITY: usize = 64;
const DEFAULT_API_URL: &str = "https://sedapalweb.com/fastapi/";
const LEGACY_API_URL: &str = concat!("https://api.", "sedapal.lat");
const LEGACY_SEDAPALWEB_API_URL: &str = concat!("https://api.", "sedapalweb.com");
const SEDAPAL_LAN_FIRST_OCTET: u8 = 1;
const SEDAPAL_LAN_SECOND_OCTET: u8 = 8;
const EVIDENCE_PATH_PREFIX: &str = "/uploads/supervision-media/";
// Un video de campo entero por IPC bloquea el webview: 48 MB cubre las
// fotos y los clips habituales, y lo que exceda se rechaza con mensaje.
const MAX_EVIDENCE_BYTES: usize = 48 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error("No se pudo conectar con el servicio GIS.")]
    Network(#[from] reqwest::Error),
    #[error("La dirección del servicio GIS no es segura.")]
    UnsafeUrl,
    #[error("La sesión expiró. Inicia sesión nuevamente.")]
    Unauthorized,
    #[error("Usuario o contraseña incorrectos.")]
    LoginRejected,
    #[error("El servicio GIS devolvió una respuesta inválida.")]
    InvalidResponse,
    #[error("{0}")]
    Api(String),
    #[error("No se pudo acceder al almacén seguro de credenciales.")]
    Credential,
    #[error("No se pudo abrir la ventana de Google Maps.")]
    WindowCreation,
    #[error("Las coordenadas indicadas no son válidas.")]
    InvalidCoordinates,
    #[error("No se pudo capturar la ventana de Street View: {0}")]
    Capture(String),
    #[error("Configurá OLLAMA_API_KEY para analizar pisos con Ollama.")]
    OllamaNotConfigured,
    #[error("Ollama no pudo analizar la imagen: {0}")]
    OllamaRequest(String),
    #[error("No se pudo leer la carpeta de fotos: {0}")]
    PhotoFolder(String),
    #[error("No se pudo leer la imagen: {0}")]
    PhotoDecode(String),
    #[error("Ya hay un análisis en curso.")]
    AnalysisBusy,
    #[error("Esta ruta no pertenece a una carpeta seleccionada en esta sesión.")]
    PathNotAllowed,
    #[error("No se pudo generar el Excel: {0}")]
    ExcelExport(String),
    #[error("Acción no permitida: el usuario tiene permisos de solo consulta.")]
    ReadOnlyUser,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let code = match self {
            Self::Network(_) => "network",
            Self::UnsafeUrl => "unsafe_url",
            Self::Unauthorized => "unauthorized",
            Self::LoginRejected => "login_rejected",
            Self::InvalidResponse => "invalid_response",
            Self::Api(_) => "api_error",
            Self::Credential => "credential_store",
            Self::WindowCreation => "window_creation",
            Self::InvalidCoordinates => "invalid_coordinates",
            Self::Capture(_) => "capture_failed",
            Self::OllamaNotConfigured => "ollama_not_configured",
            Self::OllamaRequest(_) => "ollama_request_failed",
            Self::PhotoFolder(_) => "photo_folder_failed",
            Self::PhotoDecode(_) => "photo_decode_failed",
            Self::AnalysisBusy => "analysis_busy",
            Self::PathNotAllowed => "path_not_allowed",
            Self::ExcelExport(_) => "excel_export_failed",
            Self::ReadOnlyUser => "read_only_user",
        };
        serde_json::json!({ "code": code, "message": self.to_string() }).serialize(serializer)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionUser {
    id: String,
    email: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    is_read_only: bool,
}

impl SessionUser {
    fn compute_is_read_only(&self) -> bool {
        let is_myfsedapal = |s: &str| {
            let lower = s.trim().to_lowercase();
            lower == "myfsedapal" || lower.starts_with("myfsedapal@")
        };

        if let Some(ref email) = self.email {
            if is_myfsedapal(email) {
                return true;
            }
        }
        if let Some(ref username) = self.username {
            if is_myfsedapal(username) {
                return true;
            }
        }
        if let Some(ref role) = self.role {
            let lower = role.trim().to_lowercase();
            if lower == "read_only"
                || lower == "readonly"
                || lower == "consulta"
                || lower == "visualizador"
            {
                return true;
            }
        }
        false
    }
}

fn extract_jwt_claims(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
    let payload = parts[1];
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user: SessionUser,
}

#[derive(Debug, Clone)]
struct Session {
    access_token: String,
    refresh_token: String,
    expires_at: Instant,
    user: SessionUser,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSnapshot {
    authenticated: bool,
    user: Option<SessionUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayersRequest {
    bbox: [f64; 4],
    layers: Vec<String>,
    page: u32,
    page_size: u32,
    zoom: f64,
    district: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportsMasterRequest {
    page: u32,
    page_size: u32,
    search: String,
    filter_active: bool,
    trend_direction: String,
    min_trend_percent: f64,
    client_type: Option<String>,
    sort_order: Option<String>,
    baseline_start_period: String,
    baseline_end_period: String,
    target_start_period: String,
    target_end_period: String,
}

#[derive(Clone)]
struct CachedValue {
    inserted_at: Instant,
    value: Value,
}

#[derive(Default)]
struct ResponseCache {
    entries: HashMap<String, CachedValue>,
}

impl ResponseCache {
    fn get(&mut self, key: &str) -> Option<Value> {
        self.entries.retain(|k, item| {
            k == "gis_district_catalog"
                || k.starts_with("reports_master:")
                || item.inserted_at.elapsed() < CACHE_TTL
        });
        self.entries.get(key).map(|item| item.value.clone())
    }

    fn insert(&mut self, key: String, value: Value) {
        if self.entries.len() >= CACHE_CAPACITY {
            let oldest = self
                .entries
                .iter()
                .filter(|(k, _)| {
                    k.as_str() != "gis_district_catalog" && !k.starts_with("reports_master:")
                })
                .min_by_key(|(_, item)| item.inserted_at)
                .map(|(key, _)| key.clone())
                .or_else(|| {
                    self.entries
                        .iter()
                        .min_by_key(|(_, item)| item.inserted_at)
                        .map(|(key, _)| key.clone())
                });
            if let Some(key_to_remove) = oldest {
                self.entries.remove(&key_to_remove);
            }
        }
        self.entries.insert(
            key,
            CachedValue {
                inserted_at: Instant::now(),
                value,
            },
        );
    }

    fn clear(&mut self) {
        self.entries.clear();
    }

    fn clear_gis_layers(&mut self) {
        self.entries
            .retain(|key, _| key == "gis_district_catalog" || key.starts_with("reports_master:"));
    }
}

pub(crate) struct AppState {
    pub(crate) base_url: Url,
    pub(crate) client: Client,
    pub(crate) session: Mutex<Option<Session>>,
    pub(crate) cache: Mutex<ResponseCache>,
    pub(crate) ollama_config: Mutex<Option<streetview::CachedOllamaConfig>>,
}

impl AppState {
    fn new() -> Result<Self, AppError> {
        let configured = configured_api_url();
        let base_url = validate_base_url(&configured)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .user_agent(format!("SEDAPALGIS/{}", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            base_url,
            client,
            session: Mutex::new(None),
            cache: Mutex::new(ResponseCache::default()),
            ollama_config: Mutex::new(None),
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url, AppError> {
        if path.contains("://") || path.contains("..") || path.contains('?') || path.contains('#') {
            return Err(AppError::UnsafeUrl);
        }
        self.base_url
            .join(path.trim_start_matches('/'))
            .map_err(|_| AppError::UnsafeUrl)
    }

    async fn refresh_session(&self, refresh_token: &str) -> Result<Session, AppError> {
        let response = self
            .client
            .post(self.endpoint("api/v1/auth/refresh")?)
            .json(&serde_json::json!({ "refreshToken": refresh_token }))
            .send()
            .await?;
        parse_token_response(response, false).await
    }

    async fn access_token(&self, force_refresh: bool) -> Result<String, AppError> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            if let Ok(refresh_token) = credential_entry()
                .and_then(|entry| entry.get_password().map_err(|_| AppError::Credential))
            {
                *guard = Some(self.refresh_session(&refresh_token).await?);
            }
        }
        let needs_refresh = guard
            .as_ref()
            .map(|session| {
                force_refresh || session.expires_at <= Instant::now() + Duration::from_secs(30)
            })
            .unwrap_or(true);
        if needs_refresh {
            let refresh_token = guard
                .as_ref()
                .ok_or(AppError::Unauthorized)?
                .refresh_token
                .clone();
            let refreshed = self.refresh_session(&refresh_token).await?;
            save_refresh_token(&refreshed.refresh_token)?;
            *guard = Some(refreshed);
        }
        guard
            .as_ref()
            .map(|session| session.access_token.clone())
            .ok_or(AppError::Unauthorized)
    }

    pub(crate) async fn require_write_permission(&self) -> Result<(), AppError> {
        let guard = self.session.lock().await;
        if let Some(ref session) = *guard {
            if session.user.is_read_only {
                return Err(AppError::ReadOnlyUser);
            }
        }
        Ok(())
    }

    pub(crate) async fn authenticated_get(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<Value, AppError> {
        self.authenticated_get_with_timeout(path, query, Duration::from_secs(30))
            .await
    }

    async fn authenticated_get_with_timeout(
        &self,
        path: &str,
        query: &[(&str, String)],
        timeout: Duration,
    ) -> Result<Value, AppError> {
        let mut retries = 0;
        loop {
            let mut unauthorized = false;
            for force_refresh in [false, true] {
                let token = self.access_token(force_refresh).await?;
                let response = self
                    .client
                    .get(self.endpoint(path)?)
                    .query(query)
                    .bearer_auth(token)
                    .timeout(timeout)
                    .send()
                    .await?;
                if response.status() == StatusCode::UNAUTHORIZED && !force_refresh {
                    unauthorized = true;
                    continue;
                }
                if response.status() == StatusCode::TOO_MANY_REQUESTS && retries < 2 {
                    let delay_ms = response
                        .headers()
                        .get("retry-after")
                        .and_then(|val| val.to_str().ok())
                        .and_then(|val| val.parse::<u64>().ok())
                        .map(|s| s * 1000)
                        .unwrap_or(600);
                    tokio::time::sleep(Duration::from_millis(delay_ms.min(3000))).await;
                    retries += 1;
                    unauthorized = false;
                    break;
                }
                return parse_json_response(response).await;
            }
            if unauthorized {
                return Err(AppError::Unauthorized);
            }
        }
    }

    /// Igual que `authenticated_get_with_timeout` pero devuelve el cuerpo crudo.
    /// La evidencia de supervisiones son imágenes y videos, no JSON, y el
    /// webview no puede pedirlos por su cuenta: la CSP no admite el origen del
    /// API como `img-src`, y aunque lo admitiera un `<img>` no lleva cabecera
    /// `Authorization`. Por eso los bytes cruzan por aquí y llegan al frontend
    /// como data URL, que la CSP sí permite.
    pub(crate) async fn authenticated_get_bytes(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<(Vec<u8>, String), AppError> {
        let mut retries = 0;
        loop {
            let mut unauthorized = false;
            for force_refresh in [false, true] {
                let token = self.access_token(force_refresh).await?;
                let response = self
                    .client
                    .get(self.endpoint(path)?)
                    .query(query)
                    .bearer_auth(token)
                    .timeout(Duration::from_secs(60))
                    .send()
                    .await?;
                if response.status() == StatusCode::UNAUTHORIZED && !force_refresh {
                    unauthorized = true;
                    continue;
                }
                if response.status() == StatusCode::TOO_MANY_REQUESTS && retries < 2 {
                    let delay_ms = response
                        .headers()
                        .get("retry-after")
                        .and_then(|val| val.to_str().ok())
                        .and_then(|val| val.parse::<u64>().ok())
                        .map(|s| s * 1000)
                        .unwrap_or(600);
                    tokio::time::sleep(Duration::from_millis(delay_ms.min(3000))).await;
                    retries += 1;
                    unauthorized = false;
                    break;
                }
                if !response.status().is_success() {
                    return Err(AppError::Api(format!(
                        "No se pudo descargar la evidencia ({}).",
                        response.status().as_u16()
                    )));
                }
                let content_type = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let bytes = response.bytes().await?;
                if bytes.len() > MAX_EVIDENCE_BYTES {
                    return Err(AppError::Api(
                        "El archivo de evidencia es demasiado grande para mostrarlo aquí."
                            .to_string(),
                    ));
                }
                return Ok((bytes.to_vec(), content_type));
            }
            if unauthorized {
                return Err(AppError::Unauthorized);
            }
        }
    }

    pub(crate) async fn authenticated_post(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<Value, AppError> {
        self.authenticated_post_with_timeout(path, body, Duration::from_secs(30))
            .await
    }

    async fn authenticated_post_with_timeout(
        &self,
        path: &str,
        body: &Value,
        timeout: Duration,
    ) -> Result<Value, AppError> {
        let mut retries = 0;
        loop {
            let mut unauthorized = false;
            for force_refresh in [false, true] {
                let token = self.access_token(force_refresh).await?;
                let response = self
                    .client
                    .post(self.endpoint(path)?)
                    .bearer_auth(token)
                    .json(body)
                    .timeout(timeout)
                    .send()
                    .await?;
                if response.status() == StatusCode::UNAUTHORIZED && !force_refresh {
                    unauthorized = true;
                    continue;
                }
                if response.status() == StatusCode::TOO_MANY_REQUESTS && retries < 2 {
                    let delay_ms = response
                        .headers()
                        .get("retry-after")
                        .and_then(|val| val.to_str().ok())
                        .and_then(|val| val.parse::<u64>().ok())
                        .map(|s| s * 1000)
                        .unwrap_or(600);
                    tokio::time::sleep(Duration::from_millis(delay_ms.min(3000))).await;
                    retries += 1;
                    unauthorized = false;
                    break;
                }
                return parse_json_response(response).await;
            }
            if unauthorized {
                return Err(AppError::Unauthorized);
            }
        }
    }

    /// PATCH y DELETE autenticados, con el mismo reintento por 401 que el resto
    /// del proxy. Los agrega el modulo de fotos de medidores, que actualiza
    /// contadores de ejecucion y borra etiquetas/reglas.
    ///
    /// No se implementa el backoff por 429 de GET/POST: estas dos rutas las
    /// llama la interfaz de configuracion de a una, no una cola.
    pub(crate) async fn authenticated_patch(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<Value, AppError> {
        self.authenticated_request_json(reqwest::Method::PATCH, path, body)
            .await
    }

    pub(crate) async fn authenticated_delete(&self, path: &str) -> Result<Value, AppError> {
        self.authenticated_request(reqwest::Method::DELETE, path, None)
            .await
    }

    pub(crate) async fn authenticated_request_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &Value,
    ) -> Result<Value, AppError> {
        self.authenticated_request(method, path, Some(body)).await
    }

    async fn authenticated_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, AppError> {
        let mut unauthorized = false;
        for force_refresh in [false, true] {
            let token = self.access_token(force_refresh).await?;
            let mut request = self
                .client
                .request(method.clone(), self.endpoint(path)?)
                .bearer_auth(token)
                .timeout(Duration::from_secs(30));
            if let Some(payload) = body {
                request = request.json(payload);
            }
            let response = request.send().await?;
            if response.status() == StatusCode::UNAUTHORIZED && !force_refresh {
                unauthorized = true;
                continue;
            }
            return parse_json_response(response).await;
        }
        if unauthorized {
            return Err(AppError::Unauthorized);
        }
        Err(AppError::InvalidResponse)
    }
}

fn configured_api_url() -> String {
    if let Ok(value) = env::var("SEDAPALGIS_API_URL") {
        let value = value.trim();
        if !value.is_empty() {
            return migrate_legacy_api_url(value);
        }
    }

    if let Some(value) = local_api_url() {
        return migrate_legacy_api_url(&value);
    }

    DEFAULT_API_URL.to_string()
}

fn migrate_legacy_api_url(value: &str) -> String {
    if matches!(
        value.trim().trim_end_matches('/'),
        LEGACY_API_URL | LEGACY_SEDAPALWEB_API_URL
    ) {
        DEFAULT_API_URL.to_string()
    } else {
        value.trim().to_string()
    }
}

fn local_api_url() -> Option<String> {
    let local_app_data = env::var_os("LOCALAPPDATA")?;
    let path = PathBuf::from(local_app_data)
        .join("SEDAPALGIS")
        .join("api-url.txt");
    let value = fs::read_to_string(path).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn is_sedapal_lan_host(host: &str) -> bool {
    matches!(
        host.parse::<IpAddr>(),
        Ok(IpAddr::V4(address))
            if address.octets()[0] == SEDAPAL_LAN_FIRST_OCTET
                && address.octets()[1] == SEDAPAL_LAN_SECOND_OCTET
    )
}

fn validate_base_url(value: &str) -> Result<Url, AppError> {
    let mut url = Url::parse(value).map_err(|_| AppError::UnsafeUrl)?;
    let host = url.host_str().ok_or(AppError::UnsafeUrl)?;
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    let allowed_http = loopback || is_sedapal_lan_host(host);
    if url.scheme() != "https" && !(url.scheme() == "http" && allowed_http) {
        return Err(AppError::UnsafeUrl);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl);
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::UnsafeUrl);
    }
    let path = url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("{path}/")
    };
    url.set_path(&normalized_path);
    Ok(url)
}

fn credential_entry() -> Result<Entry, AppError> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|_| AppError::Credential)
}

fn save_refresh_token(token: &str) -> Result<(), AppError> {
    credential_entry()?
        .set_password(token)
        .map_err(|_| AppError::Credential)
}

async fn parse_token_response(
    response: reqwest::Response,
    login_attempt: bool,
) -> Result<Session, AppError> {
    if response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::BAD_REQUEST
    {
        return Err(if login_attempt {
            AppError::LoginRejected
        } else {
            AppError::Unauthorized
        });
    }
    if !response.status().is_success() {
        return Err(read_api_error(response).await);
    }
    let payload: TokenResponse = response
        .json()
        .await
        .map_err(|_| AppError::InvalidResponse)?;
    let mut user = payload.user;
    if let Some(claims) = extract_jwt_claims(&payload.access_token) {
        if user.username.is_none() {
            user.username = claims
                .get("username")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
        }
        if user.role.is_none() {
            user.role = claims
                .get("role")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
        }
        if user.email.is_none() {
            user.email = claims
                .get("email")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
        }
    }
    user.is_read_only = user.compute_is_read_only();
    Ok(Session {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Instant::now() + Duration::from_secs(payload.expires_in),
        user,
    })
}

async fn parse_json_response(response: reqwest::Response) -> Result<Value, AppError> {
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(read_api_error(response).await);
    }
    response.json().await.map_err(|_| AppError::InvalidResponse)
}

async fn read_api_error(response: reqwest::Response) -> AppError {
    let status = response.status();
    let detail = response.json::<Value>().await.ok().and_then(|value| {
        ["detail", "msg", "message", "error_description"]
            .iter()
            .find_map(|key| value.get(key).and_then(Value::as_str).map(str::to_owned))
    });
    AppError::Api(
        detail.unwrap_or_else(|| format!("El servicio GIS respondió con estado {status}.")),
    )
}

#[tauri::command]
async fn login(
    state: State<'_, Arc<AppState>>,
    identifier: String,
    password: String,
) -> Result<SessionSnapshot, AppError> {
    let response = state
        .client
        .post(state.endpoint("api/v1/auth/login")?)
        .json(&serde_json::json!({ "identifier": identifier, "password": password }))
        .send()
        .await?;
    let mut session = parse_token_response(response, true).await?;
    if session.user.username.is_none() {
        session.user.username = Some(identifier.clone());
    }
    let lower_ident = identifier.trim().to_lowercase();
    if lower_ident == "myfsedapal" || lower_ident.starts_with("myfsedapal@") {
        session.user.is_read_only = true;
    } else {
        session.user.is_read_only = session.user.compute_is_read_only();
    }
    save_refresh_token(&session.refresh_token)?;
    let snapshot = SessionSnapshot {
        authenticated: true,
        user: Some(session.user.clone()),
    };
    *state.session.lock().await = Some(session);
    state.cache.lock().await.clear();
    Ok(snapshot)
}

#[tauri::command]
async fn logout(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    if let Ok(token) = state.access_token(false).await {
        let _ = state
            .client
            .post(state.endpoint("api/v1/auth/logout")?)
            .bearer_auth(token)
            .send()
            .await;
    }
    *state.session.lock().await = None;
    state.cache.lock().await.clear();
    streetview::invalidate_ollama_config(&state).await;
    if let Ok(entry) = credential_entry() {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[tauri::command]
async fn get_session(state: State<'_, Arc<AppState>>) -> Result<SessionSnapshot, AppError> {
    if state.access_token(false).await.is_err() {
        return Ok(SessionSnapshot {
            authenticated: false,
            user: None,
        });
    }
    let guard = state.session.lock().await;
    Ok(SessionSnapshot {
        authenticated: guard.is_some(),
        user: guard.as_ref().map(|session| session.user.clone()),
    })
}

#[tauri::command]
async fn fetch_gis_layers(
    state: State<'_, Arc<AppState>>,
    request: LayersRequest,
) -> Result<Value, AppError> {
    let bbox = request
        .bbox
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let layers = request.layers.join(",");
    let mut query = vec![
        ("bbox", bbox),
        ("layers", layers),
        ("page", request.page.to_string()),
        ("page_size", request.page_size.to_string()),
        ("zoom", request.zoom.to_string()),
    ];
    if let Some(district) = request.district.filter(|value| !value.trim().is_empty()) {
        query.push(("district", district));
    }
    // Las respuestas de capas contienen miles de geometrías y ya se reutilizan
    // por cobertura en el frontend. Guardarlas también como serde_json::Value
    // retenía cientos de MB en el proceso Rust al panear por encuadres distintos.
    state.authenticated_get("api/v1/gis/capas", &query).await
}

#[tauri::command]
async fn fetch_districts(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let cache_key = "gis_district_catalog";
    if let Some(value) = state.cache.lock().await.get(cache_key) {
        return Ok(value);
    }
    let value = state.authenticated_get("api/v1/gis/distritos", &[]).await?;
    state
        .cache
        .lock()
        .await
        .insert(cache_key.to_string(), value.clone());
    Ok(value)
}

#[tauri::command]
async fn resolve_location(
    state: State<'_, Arc<AppState>>,
    lng: f64,
    lat: f64,
    tolerance_m: f64,
) -> Result<Value, AppError> {
    state
        .authenticated_get(
            "api/v1/gis/relacion",
            &[
                ("lng", lng.to_string()),
                ("lat", lat.to_string()),
                ("tolerance_m", tolerance_m.to_string()),
            ],
        )
        .await
}

#[tauri::command]
async fn get_supply_detail(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/gis/suministro/{encoded}"), &[])
        .await
}

#[tauri::command]
async fn get_supply_consumption(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/gis/suministro/{encoded}/consumo"), &[])
        .await
}

#[tauri::command]
async fn get_supply_report(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/reportes/suministro/{encoded}"), &[])
        .await
}

#[tauri::command]
async fn get_client_lot_report(
    state: State<'_, Arc<AppState>>,
    supply_codes: Vec<String>,
) -> Result<Value, AppError> {
    let normalized: Vec<String> = supply_codes
        .into_iter()
        .map(|code| code.trim().to_string())
        .filter(|code| !code.is_empty())
        .take(50)
        .collect();
    if normalized.len() < 2 {
        return Err(AppError::Api(
            "El reporte por cliente y lote requiere al menos dos NIS.".to_string(),
        ));
    }
    let query: Vec<(&str, String)> = normalized
        .into_iter()
        .map(|code| ("supply_codes", code))
        .collect();
    state
        .authenticated_get_with_timeout(
            "api/v1/reportes/cliente-lote/reporte",
            &query,
            Duration::from_secs(90),
        )
        .await
}

#[tauri::command]
async fn get_supply_report_header(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/reportes/suministro/{encoded}/header"), &[])
        .await
}

#[tauri::command]
async fn get_supply_report_spatial(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(
            &format!("api/v1/reportes/suministro/{encoded}/spatial"),
            &[],
        )
        .await
}

#[tauri::command]
async fn get_supply_report_details(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(
            &format!("api/v1/reportes/suministro/{encoded}/details"),
            &[],
        )
        .await
}

#[tauri::command]
async fn get_supply_report_temporal(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(
            &format!("api/v1/reportes/suministro/{encoded}/temporal"),
            &[],
        )
        .await
}

#[tauri::command]
async fn get_supply_evidence(
    state: State<'_, Arc<AppState>>,
    supply_code: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(supply_code.as_bytes()).collect();
    state
        .authenticated_get(
            &format!("api/v1/reportes/suministro/{encoded}/evidencias"),
            &[],
        )
        .await
}

/// Descarga una evidencia y la devuelve como base64.
///
/// Igual criterio que `open_maps_window`: el frontend no elige el origen. Sólo
/// puede pedir rutas del prefijo de evidencias, que es lo que devolvió
/// `get_supply_evidence`; el backend valida lo mismo por su cuenta.
#[tauri::command]
async fn get_evidence_media(
    state: State<'_, Arc<AppState>>,
    path: String,
    thumb: bool,
) -> Result<Value, AppError> {
    if !path.starts_with(EVIDENCE_PATH_PREFIX) || path.contains("..") {
        return Err(AppError::Api("Ruta de evidencia inválida.".to_string()));
    }
    let (bytes, mime_type) = state
        .authenticated_get_bytes(
            "api/v1/reportes/evidencia",
            &[
                ("path", path),
                ("thumb", if thumb { "true" } else { "false" }.to_string()),
            ],
        )
        .await?;
    Ok(serde_json::json!({
        "mimeType": mime_type,
        "base64": BASE64_STANDARD.encode(bytes),
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn get_abrupt_consumption_drops(
    state: State<'_, Arc<AppState>>,
    page: u32,
    page_size: u32,
    classification: Option<String>,
    kind: Option<String>,
    search: Option<String>,
    district: Option<String>,
    analysis_scope: Option<String>,
) -> Result<Value, AppError> {
    let mut query = vec![
        ("page", page.max(1).to_string()),
        ("page_size", page_size.clamp(1, 100).to_string()),
    ];
    if let Some(value) = classification {
        if matches!(
            value.as_str(),
            "grandes_clientes" | "fuente_propia" | "operativo"
        ) {
            query.push(("classification", value));
        }
    }
    if let Some(value) = kind {
        if matches!(value.as_str(), "zero" | "extremely_low") {
            query.push(("kind", value));
        }
    }
    if let Some(value) = search {
        let normalized = value.trim();
        if !normalized.is_empty() {
            query.push(("search", normalized.chars().take(160).collect()));
        }
    }
    if let Some(value) = district {
        let normalized = value.trim();
        if !normalized.is_empty() {
            query.push(("district", normalized.chars().take(100).collect()));
        }
    }
    let scope = analysis_scope.unwrap_or_else(|| "supply".to_string());
    query.push((
        "analysis_scope",
        if scope == "property" {
            "property"
        } else {
            "supply"
        }
        .to_string(),
    ));
    state
        .authenticated_get_with_timeout(
            "api/v1/reportes/anomalias/caidas-consumo",
            &query,
            Duration::from_secs(90),
        )
        .await
}

#[tauri::command]
async fn get_reports_master(
    state: State<'_, Arc<AppState>>,
    request: ReportsMasterRequest,
) -> Result<Value, AppError> {
    let page = request.page.max(1);
    let page_size = request.page_size.clamp(1, 100);
    let direction = match request.trend_direction.as_str() {
        "increasing" | "decreasing" | "either" => request.trend_direction,
        _ => "either".to_string(),
    };
    let sort_order = match request.sort_order.as_deref() {
        Some("asc") => "asc".to_string(),
        _ => "desc".to_string(),
    };
    let mut query = vec![
        ("page", page.to_string()),
        ("page_size", page_size.to_string()),
        ("search", request.search.trim().to_string()),
        ("filter_active", request.filter_active.to_string()),
        ("trend_direction", direction),
        (
            "min_trend_percent",
            request.min_trend_percent.max(0.0).to_string(),
        ),
        ("sort_order", sort_order),
        ("baseline_start_period", request.baseline_start_period),
        ("baseline_end_period", request.baseline_end_period),
        ("target_start_period", request.target_start_period),
        ("target_end_period", request.target_end_period),
    ];
    if let Some(ct) = request.client_type {
        query.push(("client_type", ct));
    }
    let cache_key = format!(
        "reports_master:{}",
        serde_json::to_string(&query).map_err(|_| AppError::InvalidResponse)?
    );
    if let Some(value) = state.cache.lock().await.get(&cache_key) {
        return Ok(value);
    }
    let value = state
        .authenticated_get_with_timeout("api/v1/reportes/master", &query, Duration::from_secs(60))
        .await?;
    state.cache.lock().await.insert(cache_key, value.clone());
    Ok(value)
}

#[tauri::command]
async fn get_dashboard(
    state: State<'_, Arc<AppState>>,
    tab: Option<String>,
) -> Result<Value, AppError> {
    // Allowlist en vez de reenviar el valor tal cual: el frontend no puede
    // inyectar parámetros arbitrarios en la query del backend.
    let tab = match tab.as_deref() {
        Some("resumen") => Some("resumen"),
        Some("distribucion") => Some("distribucion"),
        Some("volumenes") => Some("volumenes"),
        _ => None,
    };
    let query: Vec<(&str, String)> = tab
        .map(|value| vec![("tab", value.to_string())])
        .unwrap_or_default();
    // El dashboard agrega cartera, pagos y deuda de toda la empresa: es la
    // consulta más pesada del backend y se cachea igual que reportes/master.
    let cache_key = format!("dashboard:{}", tab.unwrap_or("all"));
    if let Some(value) = state.cache.lock().await.get(&cache_key) {
        return Ok(value);
    }
    let value = state
        .authenticated_get_with_timeout("api/dashboard", &query, Duration::from_secs(90))
        .await?;
    state.cache.lock().await.insert(cache_key, value.clone());
    Ok(value)
}

#[tauri::command]
async fn fetch_gis_cache_revisions(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state
        .authenticated_get("api/v1/gis/cache-revisions", &[])
        .await
}

#[tauri::command]
async fn send_agent_message(
    state: State<'_, Arc<AppState>>,
    payload: Value,
) -> Result<Value, AppError> {
    let mode = payload
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("quick");
    let timeout = if mode == "deep" {
        Duration::from_secs(120)
    } else {
        Duration::from_secs(45)
    };
    state
        .authenticated_post_with_timeout("api/v1/agent/chat", &payload, timeout)
        .await
}

#[tauri::command]
async fn search_cadastre(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Value, AppError> {
    state
        .authenticated_get(
            "api/v1/gis/catastro/buscar",
            &[("query", query), ("kind", "all".to_string())],
        )
        .await
}

#[tauri::command]
async fn search_places(
    state: State<'_, Arc<AppState>>,
    query: String,
    lat: Option<f64>,
    lng: Option<f64>,
) -> Result<Value, AppError> {
    let mut params = vec![("q", query)];
    if let (Some(lat), Some(lng)) = (lat, lng) {
        params.push(("lat", lat.to_string()));
        params.push(("lng", lng.to_string()));
    }
    state
        .authenticated_get("api/geocode/suggest", &params)
        .await
}

#[tauri::command]
async fn resolve_place(
    state: State<'_, Arc<AppState>>,
    text: String,
    place_id: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
) -> Result<Value, AppError> {
    let mut params = vec![("text", text)];
    if let Some(place_id) = place_id {
        params.push(("placeId", place_id));
    }
    if let (Some(lat), Some(lng)) = (lat, lng) {
        params.push(("lat", lat.to_string()));
        params.push(("lng", lng.to_string()));
    }
    state.authenticated_get("api/geocode/place", &params).await
}

#[tauri::command]
async fn save_geometry_correction(
    state: State<'_, Arc<AppState>>,
    target_kind: String,
    target_id: String,
    delta_lng: f64,
    delta_lat: f64,
    reset: bool,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    let value = state
        .authenticated_post(
            "api/v1/gis/catastro/ajuste",
            &serde_json::json!({
                "targetKind": target_kind,
                "targetId": target_id,
                "deltaLng": delta_lng,
                "deltaLat": delta_lat,
                "reset": reset,
            }),
        )
        .await?;
    state.cache.lock().await.clear_gis_layers();
    Ok(value)
}

#[tauri::command]
async fn get_building_footprint(
    state: State<'_, Arc<AppState>>,
    lot_id: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(lot_id.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/gis/catastro/lote/{encoded}/huella"), &[])
        .await
}

#[tauri::command]
async fn save_building_footprint(
    state: State<'_, Arc<AppState>>,
    lot_id: String,
    geometry: Value,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_post(
            "api/v1/gis/catastro/huella",
            &serde_json::json!({
                "lotId": lot_id,
                "geometry": geometry,
                "source": "manual",
            }),
        )
        .await
}

#[tauri::command]
async fn get_building_facade(
    state: State<'_, Arc<AppState>>,
    lot_id: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(lot_id.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/gis/facades/{encoded}"), &[])
        .await
}

#[tauri::command]
async fn suggest_lot_split(
    state: State<'_, Arc<AppState>>,
    bbox: [f64; 4],
) -> Result<Value, AppError> {
    let suggestion = lot_split::suggest_split(&state, bbox).await?;
    serde_json::to_value(suggestion).map_err(|_| AppError::InvalidResponse)
}

#[tauri::command]
async fn save_lot_split(
    state: State<'_, Arc<AppState>>,
    lot_id: String,
    line: Option<Value>,
    reset: bool,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    let value = state
        .authenticated_post(
            "api/v1/gis/catastro/dividir",
            &serde_json::json!({
                "lotId": lot_id,
                "line": line,
                "reset": reset,
            }),
        )
        .await?;
    state.cache.lock().await.clear_gis_layers();
    Ok(value)
}

#[tauri::command]
async fn get_lot_context(
    state: State<'_, Arc<AppState>>,
    lot_id: String,
) -> Result<Value, AppError> {
    let encoded: String = url::form_urlencoded::byte_serialize(lot_id.as_bytes()).collect();
    state
        .authenticated_get(&format!("api/v1/gis/lote/{encoded}"), &[])
        .await
}

#[tauri::command]
async fn get_tile_server_url(
    state: State<'_, Arc<AppState>>,
    duration_hours: Option<u32>,
) -> Result<String, AppError> {
    let body = match duration_hours {
        Some(hours) => serde_json::json!({ "hours": hours }),
        None => serde_json::json!({}),
    };
    let response = state
        .authenticated_post("api/v1/gis/tiles/session", &body)
        .await?;
    response
        .get("tileBaseUrl")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(AppError::InvalidResponse)
}

use streetview::MAPS_WINDOW_LABEL;

/// Construye la URL de Google Maps en Rust a propósito.
///
/// Si aceptáramos la URL desde el frontend, este comando sería un abridor de
/// URLs arbitrarias: cualquier cadena que llegara por IPC acabaría cargándose en
/// una ventana de la aplicación. Aquí sólo entran dos números y un modo.
fn build_maps_url(lat: f64, lng: f64, mode: &str) -> Result<String, AppError> {
    if !lat.is_finite()
        || !lng.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lng)
    {
        return Err(AppError::InvalidCoordinates);
    }
    Ok(match mode {
        "streetview" => format!(
            "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat:.6},{lng:.6}"
        ),
        // Vista satélite: `data=!3m1!1e3` es el conmutador de capa satelital.
        _ => format!(
            "https://www.google.com/maps/search/?api=1&query={lat:.6}%2C{lng:.6}&basemap=satellite"
        ),
    })
}

/// Abre Google Maps en una ventana propia de la aplicación.
///
/// Se crea desde Rust porque `core:webview:default` no concede
/// `allow-create-webview-window`, así que la API equivalente de JS está vetada
/// por la ACL. La ventana carga bajo el origen de Google, de modo que la CSP de
/// la app no le aplica.
#[tauri::command]
async fn open_maps_window(
    app: tauri::AppHandle,
    streetview_runtime: State<'_, Arc<streetview::StreetviewRuntime>>,
    lat: f64,
    lng: f64,
    mode: String,
    lot_id: Option<String>,
) -> Result<(), AppError> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let url = build_maps_url(lat, lng, &mode)?;
    let parsed = Url::parse(&url).map_err(|_| AppError::InvalidCoordinates)?;
    let title = format!("Google Maps — {lat:.6}, {lng:.6}");
    let runtime = streetview_runtime.inner().clone();

    // Reutiliza la ventana existente en vez de acumular una por consulta.
    if let Some(window) = app.get_webview_window(MAPS_WINDOW_LABEL) {
        let _ = window.set_title(&title);
        window
            .navigate(parsed)
            .map_err(|_| AppError::WindowCreation)?;
        let _ = window.unminimize();
        let _ = window.show();
        window.set_focus().map_err(|_| AppError::WindowCreation)?;
    } else {
        let window =
            WebviewWindowBuilder::new(&app, MAPS_WINDOW_LABEL, WebviewUrl::External(parsed))
                .title(title)
                .inner_size(1100.0, 760.0)
                .min_inner_size(480.0, 400.0)
                .resizable(true)
                .center()
                .build()
                .map_err(|_| AppError::WindowCreation)?;
        streetview::watch_window_close(&window, app.clone(), runtime.clone());
    }

    // El seguimiento de posición y el análisis de pisos sólo tienen sentido en
    // modo Street View; en satélite se corta cualquier sondeo que quedara activo.
    if mode == "streetview" {
        streetview::start_tracking(app, runtime, lot_id).await;
    } else {
        streetview::stop_tracking(&app, &runtime).await;
    }

    Ok(())
}

#[tauri::command]
async fn set_streetview_target_lot(
    streetview_runtime: State<'_, Arc<streetview::StreetviewRuntime>>,
    lot_id: Option<String>,
) -> Result<(), AppError> {
    streetview::set_target_lot(streetview_runtime.inner(), lot_id).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Análisis masivo de fotografías de medidores
// ---------------------------------------------------------------------------

const METER_API: &str = "api/v1/fotos-medidores";

/// El diálogo se abre desde Rust y no desde el webview a propósito: así no hace
/// falta conceder `dialog:allow-open` en `capabilities/default.json` ni sumar el
/// paquete npm, y la lista de carpetas permitidas queda alimentada únicamente
/// por una elección explícita del usuario.
#[tauri::command]
async fn pick_meter_photo_folder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |selected| {
        let _ = sender.send(selected);
    });
    // `blocking_pick_folder` haría deadlock: esto corre dentro del runtime async.
    let Some(folder) = receiver
        .await
        .map_err(|_| AppError::PhotoFolder("diálogo cancelado".into()))?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|err| AppError::PhotoFolder(err.to_string()))?;
    runtime.remember_root(&path).await;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn scan_meter_photo_folder(
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
    folder: String,
    include_subfolders: Option<bool>,
) -> Result<meter_analysis::ScanResult, AppError> {
    let root = runtime
        .ensure_allowed(PathBuf::from(&folder).as_path())
        .await?;
    let recursive = include_subfolders.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || meter_analysis::scan_folder(&root, recursive))
        .await
        .map_err(|err| AppError::PhotoFolder(err.to_string()))?
}

#[tauri::command]
async fn start_meter_analysis(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
    folder: String,
    include_subfolders: Option<bool>,
    concurrency: Option<usize>,
    excluded: Option<Vec<String>>,
) -> Result<Value, AppError> {
    let root = runtime
        .ensure_allowed(PathBuf::from(&folder).as_path())
        .await?;
    let recursive = include_subfolders.unwrap_or(false);
    let scan_root = root.clone();
    let mut scan = tauri::async_runtime::spawn_blocking(move || {
        meter_analysis::scan_folder(&scan_root, recursive)
    })
    .await
    .map_err(|err| AppError::PhotoFolder(err.to_string()))??;

    // El operador puede descartar fotografías antes de arrancar. Se recibe lo
    // EXCLUIDO y no lo incluido: con una carpeta de decenas de miles de fotos,
    // reenviar la lista completa serían varios MB por IPC para repetirle a Rust
    // lo que su propio escaneo ya sabe, mientras que lo descartado suele ser un
    // puñado. Descartar solo lo excluye de este análisis; el archivo queda
    // intacto en el disco.
    if let Some(descartadas) = excluded {
        if !descartadas.is_empty() {
            let fuera: std::collections::HashSet<String> = descartadas.into_iter().collect();
            scan.files.retain(|file| !fuera.contains(&file.file_path));
        }
    }

    if scan.files.is_empty() {
        return Err(AppError::PhotoFolder(
            "No quedan fotografías compatibles para analizar.".to_string(),
        ));
    }

    meter_analysis::start_run(
        app,
        Arc::clone(&state),
        Arc::clone(&runtime),
        root,
        scan.files,
        concurrency,
    )
    .await
}

#[tauri::command]
async fn cancel_meter_analysis(
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
) -> Result<(), AppError> {
    meter_analysis::cancel_run(&runtime).await;
    Ok(())
}

#[tauri::command]
async fn retry_meter_persistence(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
) -> Result<(), AppError> {
    meter_analysis::retry_persistence(app, Arc::clone(&state), Arc::clone(&runtime)).await
}

#[tauri::command]
async fn retry_meter_analysis_file(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
    run_id: String,
    file_path: String,
) -> Result<(), AppError> {
    let path = runtime
        .ensure_allowed(PathBuf::from(&file_path).as_path())
        .await?;
    let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let file = meter_analysis::ScannedFile {
        file_name,
        file_path: path.to_string_lossy().to_string(),
        size_bytes: size,
    };
    meter_analysis::retry_file(app, Arc::clone(&state), Arc::clone(&runtime), run_id, file).await
}

/// Devuelve la fotografía original como base64 para armar un `data:` URL.
///
/// La ruta llega del webview, así que sin la lista de carpetas permitidas esto
/// sería una primitiva de lectura de archivos arbitrarios. `ensure_allowed`
/// canonicaliza (resuelve `..` y symlinks) y exige que caiga dentro de una
/// carpeta elegida con el diálogo nativo en esta sesión.
#[tauri::command]
async fn get_meter_photo(
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
    path: String,
) -> Result<Value, AppError> {
    let resolved = runtime
        .ensure_allowed(PathBuf::from(&path).as_path())
        .await?;
    let extension = resolved
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err(AppError::PathNotAllowed),
    };

    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(&resolved))
        .await
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?
        .map_err(|err| AppError::PhotoDecode(err.to_string()))?;
    if bytes.len() > MAX_EVIDENCE_BYTES {
        return Err(AppError::PhotoDecode(
            "La fotografía es demasiado grande para mostrarla aquí.".to_string(),
        ));
    }

    Ok(serde_json::json!({
        "mimeType": mime,
        "base64": BASE64_STANDARD.encode(&bytes),
    }))
}

/// Configuración para la interfaz, **sin material cifrado**.
///
/// Ésta es la segunda barrera del secreto: aunque el backend devuelva el
/// ciphertext (lo necesita Rust), acá se quita antes de cruzar a IPC. No existe
/// ningún comando que devuelva la API key en claro.
#[tauri::command]
async fn get_meter_analysis_config(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let payload = state
        .authenticated_get(&format!("{METER_API}/config"), &[])
        .await?;
    Ok(mask_meter_config(payload))
}

#[tauri::command]
async fn list_meter_labels(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state
        .authenticated_get(&format!("{METER_API}/etiquetas"), &[])
        .await
}

#[tauri::command]
async fn list_meter_rules(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state
        .authenticated_get(&format!("{METER_API}/reglas"), &[])
        .await
}

#[tauri::command]
async fn save_meter_export_profile(
    state: State<'_, Arc<AppState>>,
    profile: Value,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_request_json(
            reqwest::Method::PUT,
            &format!("{METER_API}/perfil-exportacion"),
            &profile,
        )
        .await
}

#[tauri::command]
async fn test_meter_prompt(
    state: State<'_, Arc<AppState>>,
    runtime: State<'_, Arc<meter_analysis::MeterAnalysisRuntime>>,
    path: String,
    body: String,
) -> Result<meter_normalize::MeterReport, AppError> {
    let path = runtime
        .ensure_allowed(PathBuf::from(path).as_path())
        .await?;
    let config = meter_analysis::resolve_config_with_prompt(&state, Some(&body)).await?;
    let side = config.settings.max_image_side;
    let quality = config.settings.jpeg_quality;
    let image = tauri::async_runtime::spawn_blocking(move || {
        meter_analysis::prepare_image(&path, side, quality)
    })
    .await
    .map_err(|err| AppError::PhotoDecode(err.to_string()))??;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let (report, _, _) = meter_analysis::analyze_image(
        &client,
        &config.settings,
        &config.api_key,
        &config.prompt,
        &image,
    )
    .await?;
    Ok(report)
}

fn mask_meter_config(mut payload: Value) -> Value {
    // Segunda barrera del secreto: el backend manda la clave en claro porque la
    // necesita el analisis, pero se elimina antes de cruzar a IPC. No existe
    // ningun comando que le devuelva la clave al webview.
    if let Some(ollama) = payload.get_mut("ollama").and_then(Value::as_object_mut) {
        let has_api_key = ollama
            .get("api_key")
            .map(|value| !value.is_null())
            .unwrap_or(false);
        ollama.remove("api_key");
        ollama.remove("api_key_ciphertext");
        ollama.insert("hasApiKey".to_string(), serde_json::json!(has_api_key));
        // La clave es del servidor y sirve en cualquier PC: ya no hay un caso
        // de "configurada en otra computadora" que la interfaz deba distinguir.
        ollama.insert("canDecrypt".to_string(), serde_json::json!(has_api_key));
    }
    payload
}

#[tauri::command]
async fn save_meter_ollama_config(
    state: State<'_, Arc<AppState>>,
    settings: Value,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    let mut body = settings;
    let object = body.as_object_mut().ok_or(AppError::InvalidResponse)?;
    object.insert(
        "clearApiKey".to_string(),
        serde_json::json!(clear_api_key.unwrap_or(false)),
    );
    if let Some(plaintext) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        object.insert("apiKey".to_string(), serde_json::json!(plaintext));
    }

    state
        .authenticated_request_json(
            reqwest::Method::PUT,
            &format!("{METER_API}/config/ollama"),
            &body,
        )
        .await?;
    let refreshed = state
        .authenticated_get(&format!("{METER_API}/config"), &[])
        .await?;
    Ok(mask_meter_config(refreshed))
}

/// Prueba la configuración de punta a punta sin gastar una fotografía.
#[tauri::command]
async fn test_meter_ollama_connection(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let started = Instant::now();
    let config = meter_analysis::resolve_config(&state).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.settings.timeout_seconds.min(60)))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    // Se prueba contra /api/chat y no contra /api/tags: ese ultimo responde 200
    // con cualquier clave, incluso sin ninguna, asi que daria un visto bueno
    // falso justo cuando la clave esta vencida. Un mensaje minimo alcanza para
    // verificar credenciales sin gastar una fotografia.
    let url = format!("{}/api/chat", config.settings.host.trim_end_matches('/'));
    let response = client
        .post(url)
        .bearer_auth(&config.api_key)
        .json(&serde_json::json!({
            "model": config.settings.model,
            "stream": false,
            "messages": [{ "role": "user", "content": "ping" }],
        }))
        .send()
        .await
        .map_err(AppError::Network)?;
    if !response.status().is_success() {
        let status = response.status();
        let detalle = response.text().await.unwrap_or_default();
        let snippet: String = detalle.chars().take(160).collect();
        let pista = if status == StatusCode::UNAUTHORIZED {
            " La clave fue rechazada: puede estar vencida o revocada. Genera una nueva en ollama.com y guardala aqui."
        } else {
            " Revisa la clave y el modelo configurados."
        };
        return Err(AppError::OllamaRequest(format!(
            "Ollama devolvió HTTP {status}.{pista} {snippet}"
        )));
    }

    Ok(serde_json::json!({
        "ok": true,
        "model": config.settings.model,
        "promptVersion": config.prompt_version,
        "latencyMs": started.elapsed().as_millis() as u64,
    }))
}

#[tauri::command]
async fn save_meter_label(
    state: State<'_, Arc<AppState>>,
    label: Value,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_post(&format!("{METER_API}/etiquetas"), &label)
        .await
}

#[tauri::command]
async fn delete_meter_label(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_delete(&format!("{METER_API}/etiquetas/{id}"))
        .await
}

#[tauri::command]
async fn save_meter_rule(state: State<'_, Arc<AppState>>, rule: Value) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_post(&format!("{METER_API}/reglas"), &rule)
        .await
}

#[tauri::command]
async fn delete_meter_rule(state: State<'_, Arc<AppState>>, id: String) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_delete(&format!("{METER_API}/reglas/{id}"))
        .await
}

#[tauri::command]
async fn save_meter_prompt(
    state: State<'_, Arc<AppState>>,
    prompt: Value,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_post(&format!("{METER_API}/prompts"), &prompt)
        .await
}

#[tauri::command]
async fn activate_meter_prompt(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_post(
            &format!("{METER_API}/prompts/{id}/activar"),
            &serde_json::json!({}),
        )
        .await
}

#[tauri::command]
async fn list_meter_prompts(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state
        .authenticated_get(&format!("{METER_API}/prompts"), &[])
        .await
}

#[tauri::command]
async fn delete_meter_run(state: State<'_, Arc<AppState>>, id: String) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_delete(&format!("{METER_API}/ejecuciones/{id}"))
        .await
}

/// Deja el historial de análisis en cero. No toca la configuración del módulo.
#[tauri::command]
async fn delete_all_meter_runs(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state.require_write_permission().await?;
    state
        .authenticated_delete(&format!("{METER_API}/ejecuciones"))
        .await
}

#[tauri::command]
async fn list_meter_runs(
    state: State<'_, Arc<AppState>>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<Value, AppError> {
    state
        .authenticated_get(
            &format!("{METER_API}/ejecuciones"),
            &[
                ("page", page.unwrap_or(1).to_string()),
                ("pageSize", page_size.unwrap_or(25).to_string()),
            ],
        )
        .await
}

#[tauri::command]
async fn list_meter_results(
    state: State<'_, Arc<AppState>>,
    filters: Value,
) -> Result<Value, AppError> {
    state
        .authenticated_get(&format!("{METER_API}/resultados"), &meter_query(&filters))
        .await
}

#[tauri::command]
async fn get_meter_incidence_graph(
    state: State<'_, Arc<AppState>>,
    filters: Value,
) -> Result<Value, AppError> {
    state
        .authenticated_get(&format!("{METER_API}/grafo"), &meter_query(&filters))
        .await
}

/// Traduce un objeto de filtros del frontend a query params, descartando nulos.
fn meter_query(filters: &Value) -> Vec<(&'static str, String)> {
    const KEYS: [&str; 9] = [
        "ejecucion",
        "desde",
        "hasta",
        "requiereRevision",
        "incidencia",
        "q",
        "page",
        "pageSize",
        "minEdgeWeight",
    ];
    let mut query = Vec::new();
    let Some(object) = filters.as_object() else {
        return query;
    };
    for key in KEYS {
        let Some(value) = object.get(key) else {
            continue;
        };
        let rendered = match value {
            Value::Null => continue,
            Value::String(text) if text.trim().is_empty() => continue,
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        query.push((key, rendered));
    }
    query
}

/// Genera el `.xlsx` de una ejecución y lo guarda donde elija el usuario.
///
/// Devuelve `None` si el usuario cancela el diálogo. Jamás escribe en la
/// carpeta de fotografías.
#[tauri::command]
async fn export_meter_analysis_excel(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Option<Value>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    // Se pagina en vez de pedir todo de una: una corrida de decenas de miles de
    // fotografías son varios MB de JSON que, en una sola respuesta, hay que
    // sostener a la vez en Postgres, en el backend y acá, contra un timeout de
    // 30 s. Convertir cada página a `ExcelRow` al vuelo evita además guardar
    // dos representaciones completas del lote en memoria.
    const PAGINA: usize = 2000;
    let mut rows: Vec<meter_excel::ExcelRow> = Vec::new();
    let mut all_records: Vec<Value> = Vec::new();
    let mut offset = 0usize;
    loop {
        let payload = state
            .authenticated_get(
                &format!("{METER_API}/ejecuciones/{run_id}/exportacion"),
                &[
                    ("offset", offset.to_string()),
                    ("limit", PAGINA.to_string()),
                ],
            )
            .await?;
        let records = payload
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let recibidos = records.len();
        rows.extend(records.iter().map(meter_excel::row_from_record));
        all_records.extend(records);
        if recibidos < PAGINA {
            break;
        }
        offset += recibidos;
    }

    let profile = state
        .authenticated_get(&format!("{METER_API}/perfil-exportacion"), &[])
        .await
        .unwrap_or(Value::Null);
    let sheet_name = profile
        .get("sheet_name")
        .and_then(Value::as_str)
        .unwrap_or("Analisis")
        .to_string();
    let freeze = profile
        .get("freeze_header")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let autofilter = profile
        .get("autofilter")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let photo_items: Vec<meter_consolidation::SupplyPhotoItem> = all_records
        .iter()
        .map(|rec| {
            let file_name = rec
                .get("file_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let file_path = rec
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let numero_medidor = rec
                .get("numero_medidor")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let lectura = rec
                .get("lectura")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let estado_conexion = rec
                .get("estado_conexion")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let estado_medidor = rec
                .get("estado_medidor")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let observacion = rec
                .get("observacion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let requiere_revision = rec
                .get("requiere_revision")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = rec
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("done")
                .to_string();
            let (_, photo_index) = meter_consolidation::extract_supply_nis(&file_name);
            let (category, criticality, _) = meter_consolidation::evaluate_single_photo(
                &numero_medidor,
                &lectura,
                &estado_conexion,
                &estado_medidor,
                &observacion,
                &status,
            );
            meter_consolidation::SupplyPhotoItem {
                file_name,
                file_path,
                photo_index,
                category,
                criticality: criticality.as_u8(),
                numero_medidor,
                lectura,
                estado_conexion,
                estado_medidor,
                observacion,
                requiere_revision,
                status,
            }
        })
        .collect();

    let consolidated = meter_consolidation::group_and_consolidate(photo_items);
    let supplies_count = consolidated.len();
    let row_count = rows.len();
    let bytes = meter_excel::build_consolidated_workbook(
        &consolidated,
        &rows,
        &sheet_name,
        freeze,
        autofilter,
    )?;

    let suggested = format!(
        "analisis-medidores-{}.xlsx",
        run_id.chars().take(8).collect::<String>()
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&suggested)
        .add_filter("Excel", &["xlsx"])
        .save_file(move |selected| {
            let _ = sender.send(selected);
        });
    let Some(target) = receiver
        .await
        .map_err(|_| AppError::ExcelExport("diálogo cancelado".into()))?
    else {
        return Ok(None);
    };
    let target = target
        .into_path()
        .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    if !target
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("xlsx"))
    {
        return Err(AppError::ExcelExport(
            "El archivo de destino debe tener extensión .xlsx.".into(),
        ));
    }

    std::fs::write(&target, bytes).map_err(|err| AppError::ExcelExport(err.to_string()))?;

    Ok(Some(serde_json::json!({
        "path": target.to_string_lossy(),
        "rowCount": row_count,
        "suppliesCount": supplies_count,
    })))
}

/// Obtiene los resultados agrupados y consolidados por suministro (NIS)
/// aplicando la escala de criticidad del 1 al 5 y la jerarquía de prioridad.
#[tauri::command]
async fn get_meter_consolidated_results(
    state: State<'_, Arc<AppState>>,
    run_id: Option<String>,
) -> Result<Vec<meter_consolidation::SupplyConsolidatedReport>, AppError> {
    const PAGINA: usize = 2000;
    let mut all_records: Vec<Value> = Vec::new();
    let mut offset = 0usize;
    let endpoint = match &run_id {
        Some(id) if id != "all" => format!("{METER_API}/ejecuciones/{id}/exportacion"),
        _ => format!("{METER_API}/exportacion"),
    };

    loop {
        let payload = state
            .authenticated_get(
                &endpoint,
                &[
                    ("offset", offset.to_string()),
                    ("limit", PAGINA.to_string()),
                ],
            )
            .await?;
        let records = payload
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let recibidos = records.len();
        all_records.extend(records);
        if recibidos < PAGINA {
            break;
        }
        offset += recibidos;
    }

    let photo_items: Vec<meter_consolidation::SupplyPhotoItem> = all_records
        .iter()
        .map(|rec| {
            let file_name = rec
                .get("file_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let file_path = rec
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let numero_medidor = rec
                .get("numero_medidor")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let lectura = rec
                .get("lectura")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let estado_conexion = rec
                .get("estado_conexion")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let estado_medidor = rec
                .get("estado_medidor")
                .and_then(Value::as_str)
                .unwrap_or(meter_normalize::NO_VISIBLE)
                .to_string();
            let observacion = rec
                .get("observacion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let requiere_revision = rec
                .get("requiere_revision")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = rec
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("done")
                .to_string();
            let (_, photo_index) = meter_consolidation::extract_supply_nis(&file_name);
            let (category, criticality, _) = meter_consolidation::evaluate_single_photo(
                &numero_medidor,
                &lectura,
                &estado_conexion,
                &estado_medidor,
                &observacion,
                &status,
            );
            meter_consolidation::SupplyPhotoItem {
                file_name,
                file_path,
                photo_index,
                category,
                criticality: criticality.as_u8(),
                numero_medidor,
                lectura,
                estado_conexion,
                estado_medidor,
                observacion,
                requiere_revision,
                status,
            }
        })
        .collect();

    Ok(meter_consolidation::group_and_consolidate(photo_items))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("No se pudo configurar el cliente GIS");
    let streetview_runtime =
        streetview::StreetviewRuntime::new().expect("No se pudo configurar el cliente de Ollama");
    let meter_runtime = meter_analysis::MeterAnalysisRuntime::new()
        .expect("No se pudo configurar el análisis de fotos de medidores");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(state))
        .manage(Arc::new(streetview_runtime))
        .manage(Arc::new(meter_runtime))
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            get_session,
            fetch_gis_layers,
            fetch_districts,
            fetch_gis_cache_revisions,
            resolve_location,
            get_supply_detail,
            get_supply_consumption,
            get_supply_report,
            get_client_lot_report,
            get_supply_report_header,
            get_supply_report_spatial,
            get_supply_report_details,
            get_supply_report_temporal,
            get_supply_evidence,
            get_evidence_media,
            get_abrupt_consumption_drops,
            get_reports_master,
            get_dashboard,
            send_agent_message,
            search_cadastre,
            search_places,
            resolve_place,
            save_geometry_correction,
            get_building_footprint,
            save_building_footprint,
            get_building_facade,
            suggest_lot_split,
            save_lot_split,
            open_maps_window,
            set_streetview_target_lot,
            get_tile_server_url,
            get_lot_context,
            pick_meter_photo_folder,
            scan_meter_photo_folder,
            start_meter_analysis,
            cancel_meter_analysis,
            retry_meter_persistence,
            retry_meter_analysis_file,
            get_meter_photo,
            get_meter_analysis_config,
            list_meter_labels,
            list_meter_rules,
            save_meter_export_profile,
            test_meter_prompt,
            save_meter_ollama_config,
            test_meter_ollama_connection,
            save_meter_label,
            delete_meter_label,
            save_meter_rule,
            delete_meter_rule,
            save_meter_prompt,
            activate_meter_prompt,
            list_meter_prompts,
            list_meter_runs,
            delete_meter_run,
            delete_all_meter_runs,
            list_meter_results,
            get_meter_incidence_graph,
            export_meter_analysis_excel,
            get_meter_consolidated_results
        ])
        .build(tauri::generate_context!())
        .expect("Error al preparar SEDAPAL GIS");

    app.run(|_, _| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_plain_http_outside_sedapal_lan() {
        assert!(matches!(
            validate_base_url("http://example.com"),
            Err(AppError::UnsafeUrl)
        ));
        assert!(matches!(
            validate_base_url("http://10.0.0.10:8000"),
            Err(AppError::UnsafeUrl)
        ));
    }

    #[test]
    fn accepts_loopback_and_sedapal_lan_http_or_remote_https() {
        assert!(validate_base_url("http://127.0.0.1:8000").is_ok());
        assert!(validate_base_url("http://1.8.1.116:8000").is_ok());
        assert!(validate_base_url("https://api.example.com").is_ok());
    }

    #[test]
    fn preserves_fastapi_prefix_when_joining_endpoints() {
        let base = validate_base_url("https://sedapalweb.com/fastapi").unwrap();
        assert_eq!(base.as_str(), "https://sedapalweb.com/fastapi/");
        assert_eq!(
            base.join("api/v1/agent/chat").unwrap().as_str(),
            "https://sedapalweb.com/fastapi/api/v1/agent/chat"
        );
    }

    #[test]
    fn migrates_known_legacy_production_overrides() {
        let legacy_with_slash = format!("{LEGACY_API_URL}/");
        assert_eq!(migrate_legacy_api_url(&legacy_with_slash), DEFAULT_API_URL);
        assert_eq!(
            migrate_legacy_api_url(LEGACY_SEDAPALWEB_API_URL),
            DEFAULT_API_URL
        );
        assert_eq!(
            migrate_legacy_api_url("http://127.0.0.1:8000"),
            "http://127.0.0.1:8000"
        );
        assert_eq!(
            migrate_legacy_api_url("https://custom.example.com/fastapi"),
            "https://custom.example.com/fastapi"
        );
    }

    #[test]
    fn rejects_credentials_query_and_fragment_in_base_urls() {
        for value in [
            "https://user:password@example.com/fastapi/",
            "https://example.com/fastapi/?tenant=gis",
            "https://example.com/fastapi/#agent",
        ] {
            assert!(matches!(validate_base_url(value), Err(AppError::UnsafeUrl)));
        }
    }

    #[test]
    fn cache_expires_and_is_bounded() {
        let mut cache = ResponseCache::default();
        for index in 0..=CACHE_CAPACITY {
            cache.insert(index.to_string(), Value::from(index));
        }
        assert_eq!(cache.entries.len(), CACHE_CAPACITY);

        cache.insert("expired".to_string(), Value::from(true));
        cache.entries.get_mut("expired").unwrap().inserted_at =
            Instant::now() - CACHE_TTL - Duration::from_secs(1);
        assert!(cache.get("expired").is_none());
    }

    #[test]
    fn ipc_errors_keep_a_safe_machine_readable_code() {
        let value = serde_json::to_value(AppError::Unauthorized).unwrap();
        assert_eq!(value["code"], "unauthorized");
        assert_eq!(
            value["message"],
            "La sesión expiró. Inicia sesión nuevamente."
        );
    }

    #[test]
    fn local_auth_token_response_uses_camel_case_contract() {
        let response: TokenResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "access",
            "refreshToken": "refresh",
            "expiresIn": 3600,
            "user": { "id": "user-id", "email": "usuario@sedapal.com.pe" }
        }))
        .unwrap();

        assert_eq!(response.access_token, "access");
        assert_eq!(response.refresh_token, "refresh");
        assert_eq!(response.expires_in, 3600);
        assert_eq!(
            response.user.email.as_deref(),
            Some("usuario@sedapal.com.pe")
        );
        assert!(!response.user.is_read_only);
    }

    #[test]
    fn identifies_myfsedapal_and_read_only_roles() {
        let user_by_username = SessionUser {
            id: "1".into(),
            email: Some("other@sedapal.com.pe".into()),
            username: Some("myfsedapal".into()),
            role: None,
            is_read_only: false,
        };
        assert!(user_by_username.compute_is_read_only());

        let user_by_email = SessionUser {
            id: "2".into(),
            email: Some("myfsedapal@sedapal.com.pe".into()),
            username: None,
            role: None,
            is_read_only: false,
        };
        assert!(user_by_email.compute_is_read_only());

        let user_by_case = SessionUser {
            id: "3".into(),
            email: None,
            username: Some("MYFSEDAPAL".into()),
            role: None,
            is_read_only: false,
        };
        assert!(user_by_case.compute_is_read_only());

        let normal_user = SessionUser {
            id: "4".into(),
            email: Some("operador@sedapal.com.pe".into()),
            username: Some("operador".into()),
            role: Some("authenticated".into()),
            is_read_only: false,
        };
        assert!(!normal_user.compute_is_read_only());

        let error_val = serde_json::to_value(AppError::ReadOnlyUser).unwrap();
        assert_eq!(error_val["code"], "read_only_user");
    }
}
