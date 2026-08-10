use keyring::Entry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;

const CREDENTIAL_SERVICE: &str = "pe.sedapal.gis";
const CREDENTIAL_USER: &str = "refresh-token";
const CACHE_TTL: Duration = Duration::from_secs(300);
const CACHE_CAPACITY: usize = 64;
const DEFAULT_API_URL: &str = "https://api.sedapal.lat";
const LOCAL_API_CONFIG_DIR: &str = "SEDAPALGIS";
const LOCAL_API_CONFIG_FILE: &str = "api-url.txt";

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
        };
        serde_json::json!({ "code": code, "message": self.to_string() }).serialize(serializer)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionUser {
    id: String,
    email: Option<String>,
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
}

impl AppState {
    fn new() -> Result<Self, AppError> {
        let configured = configured_api_url();
        let base_url = validate_base_url(&configured)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .user_agent("SEDAPALGIS/0.1.0")
            .build()?;
        Ok(Self {
            base_url,
            client,
            session: Mutex::new(None),
            cache: Mutex::new(ResponseCache::default()),
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url, AppError> {
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
                continue;
            }
            return parse_json_response(response).await;
        }
        Err(AppError::Unauthorized)
    }

    async fn authenticated_post(&self, path: &str, body: &Value) -> Result<Value, AppError> {
        for force_refresh in [false, true] {
            let token = self.access_token(force_refresh).await?;
            let response = self
                .client
                .post(self.endpoint(path)?)
                .bearer_auth(token)
                .json(body)
                .send()
                .await?;
            if response.status() == StatusCode::UNAUTHORIZED && !force_refresh {
                continue;
            }
            return parse_json_response(response).await;
        }
        Err(AppError::Unauthorized)
    }
}

fn select_api_url(environment_value: Option<String>, file_value: Option<String>) -> String {
    environment_value
        .or(file_value)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

fn local_api_config_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|directory| {
        PathBuf::from(directory)
            .join(LOCAL_API_CONFIG_DIR)
            .join(LOCAL_API_CONFIG_FILE)
    })
}

fn configured_api_url() -> String {
    let environment_value = std::env::var("SEDAPALGIS_API_URL").ok();
    let file_value = local_api_config_path().and_then(|path| std::fs::read_to_string(path).ok());
    select_api_url(environment_value, file_value)
}

fn validate_base_url(value: &str) -> Result<Url, AppError> {
    let mut url = Url::parse(value).map_err(|_| AppError::UnsafeUrl)?;
    let host = url.host_str().ok_or(AppError::UnsafeUrl)?;
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(AppError::UnsafeUrl);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl);
    }
    url.set_path("/");
    url.set_query(None);
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
    Ok(Session {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Instant::now() + Duration::from_secs(payload.expires_in),
        user: payload.user,
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
    let session = parse_token_response(response, true).await?;
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
    let cache_key = serde_json::to_string(&query).map_err(|_| AppError::InvalidResponse)?;
    if let Some(value) = state.cache.lock().await.get(&cache_key) {
        return Ok(value);
    }
    let value = state.authenticated_get("api/v1/gis/capas", &query).await?;
    state.cache.lock().await.insert(cache_key, value.clone());
    Ok(value)
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
async fn get_abrupt_consumption_drops(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    state
        .authenticated_get("api/v1/reportes/anomalias/caidas-consumo", &[])
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
    let query = [
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
async fn save_geometry_correction(
    state: State<'_, Arc<AppState>>,
    target_kind: String,
    target_id: String,
    delta_lng: f64,
    delta_lat: f64,
    reset: bool,
) -> Result<Value, AppError> {
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
async fn get_tile_server_url(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    let response = state
        .authenticated_post("api/v1/gis/tiles/session", &serde_json::json!({}))
        .await?;
    response
        .get("tileBaseUrl")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(AppError::InvalidResponse)
}

const MAPS_WINDOW_LABEL: &str = "maps-view";

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
    lat: f64,
    lng: f64,
    mode: String,
) -> Result<(), AppError> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let url = build_maps_url(lat, lng, &mode)?;
    let parsed = Url::parse(&url).map_err(|_| AppError::InvalidCoordinates)?;
    let title = format!("Google Maps — {lat:.6}, {lng:.6}");

    // Reutiliza la ventana existente en vez de acumular una por consulta.
    if let Some(window) = app.get_webview_window(MAPS_WINDOW_LABEL) {
        let _ = window.set_title(&title);
        window
            .navigate(parsed)
            .map_err(|_| AppError::WindowCreation)?;
        let _ = window.unminimize();
        let _ = window.show();
        window.set_focus().map_err(|_| AppError::WindowCreation)?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, MAPS_WINDOW_LABEL, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 400.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|_| AppError::WindowCreation)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("No se pudo configurar el cliente GIS");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(state))
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            get_session,
            fetch_gis_layers,
            fetch_districts,
            resolve_location,
            get_supply_detail,
            get_supply_consumption,
            get_supply_report,
            get_abrupt_consumption_drops,
            get_reports_master,
            search_cadastre,
            save_geometry_correction,
            open_maps_window,
            get_tile_server_url,
            get_lot_context
        ])
        .build(tauri::generate_context!())
        .expect("Error al preparar SEDAPAL GIS");

    app.run(|_, _| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_plain_http() {
        assert!(matches!(
            validate_base_url("http://example.com"),
            Err(AppError::UnsafeUrl)
        ));
    }

    #[test]
    fn accepts_loopback_http_and_remote_https() {
        assert!(validate_base_url("http://127.0.0.1:8000").is_ok());
        assert!(validate_base_url("https://api.example.com").is_ok());
    }

    #[test]
    fn api_url_precedence_is_environment_then_local_file_then_tunnel() {
        assert_eq!(
            select_api_url(
                Some(" http://127.0.0.1:8000 ".to_string()),
                Some("https://api.example.com".to_string())
            ),
            "http://127.0.0.1:8000"
        );
        assert_eq!(
            select_api_url(None, Some(" http://localhost:8000\n".to_string())),
            "http://localhost:8000"
        );
        assert_eq!(select_api_url(None, None), DEFAULT_API_URL);
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
        assert_eq!(response.user.email.as_deref(), Some("usuario@sedapal.com.pe"));
    }
}
