//! Sugerencia de línea divisoria para partir un lote catastral en 2, cuando
//! el catastro oficial de SEDAPAL nunca registró un lote que sí existe en la
//! realidad (ver el caso confirmado en Santa Anita, MZ 108950, lote 1906).
//!
//! A diferencia del análisis de pisos de `streetview.rs` (que captura una
//! ventana de Street View), acá se pide un recorte satelital **cenital** ya
//! georreferenciado al mismo servicio Esri que usa el basemap de
//! `MapView.tsx` (`World_Imagery/MapServer`), vía su endpoint `/export` con
//! el bbox exacto del lote. Un recorte cenital sí sirve para ubicar la
//! costura entre locales en coordenadas reales; una foto oblicua de Street
//! View no, por la perspectiva de la cámara.
//!
//! La IA solo propone: el resultado se dibuja en el mapa para que el usuario
//! lo ajuste antes de guardar. Reusa la infraestructura de Ollama Cloud ya
//! configurada (`OLLAMA_HOST`/`OLLAMA_MODEL`/`OLLAMA_API_KEY`), sin introducir
//! un proveedor de IA nuevo.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::streetview::{
    extract_json_object, ollama_api_key, ollama_host, ollama_model, OllamaChatResponse,
};
use crate::AppError;

const ESRI_EXPORT_URL: &str =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
const CROP_SIDE_PX: u32 = 640;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuggestedSplit {
    /// Dos puntos `[lng, lat]` en coordenadas reales, ya convertidos desde
    /// las fracciones (0-1) que devuelve el modelo usando el bbox pedido.
    pub(crate) suggested_line: [[f64; 2]; 2],
    pub(crate) note: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SplitSuggestionPayload {
    punto1: Option<FractionalPoint>,
    punto2: Option<FractionalPoint>,
    nota: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct FractionalPoint {
    x: f64,
    y: f64,
}

impl FractionalPoint {
    fn is_valid(&self) -> bool {
        (0.0..=1.0).contains(&self.x)
            && (0.0..=1.0).contains(&self.y)
            && self.x.is_finite()
            && self.y.is_finite()
    }
}

async fn fetch_satellite_crop(client: &Client, bbox: [f64; 4]) -> Result<Vec<u8>, AppError> {
    let [minx, miny, maxx, maxy] = bbox;
    let response = client
        .get(ESRI_EXPORT_URL)
        .query(&[
            ("bbox", format!("{minx},{miny},{maxx},{maxy}")),
            ("bboxSR", "4326".to_string()),
            ("imageSR", "4326".to_string()),
            ("size", format!("{CROP_SIDE_PX},{CROP_SIDE_PX}")),
            ("format", "jpg".to_string()),
            ("f", "image".to_string()),
        ])
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::OllamaRequest(format!(
            "no se pudo obtener la imagen satelital (HTTP {})",
            response.status()
        )));
    }
    Ok(response.bytes().await?.to_vec())
}

fn fraction_to_lnglat(point: FractionalPoint, bbox: [f64; 4]) -> [f64; 2] {
    let [minx, miny, maxx, maxy] = bbox;
    let lng = minx + point.x * (maxx - minx);
    // La imagen tiene el origen (y=0) arriba/norte; el bbox geográfico tiene
    // maxy al norte, así que y=0 mapea a maxy y y=1 a miny.
    let lat = maxy - point.y * (maxy - miny);
    [lng, lat]
}

const SPLIT_LINE_INSTRUCTIONS: &str = "Estás viendo una imagen satelital cenital (vista desde arriba) de UN lote catastral. En la fachada/techo del lote hay 2 o 3 locales o viviendas distintas (se nota por el cambio de color de techo, material, o una línea que separa construcciones). Marcá la costura MÁS CLARA que separaría el lote en 2 partes: dos puntos que, unidos por una línea recta, corten el lote de un lado a otro exactamente por esa costura. Respondé ÚNICAMENTE con un JSON de la forma {\"punto1\": {\"x\": <0-1>, \"y\": <0-1>}, \"punto2\": {\"x\": <0-1>, \"y\": <0-1>}, \"nota\": \"<qué viste, breve>\"}, donde x e y son fracciones de la imagen (0,0 = esquina superior izquierda; 1,1 = esquina inferior derecha). No agregues texto fuera del JSON.";

pub(crate) async fn suggest_split(
    client: &Client,
    bbox: [f64; 4],
) -> Result<SuggestedSplit, AppError> {
    let api_key = ollama_api_key().ok_or(AppError::OllamaNotConfigured)?;
    let image_bytes = fetch_satellite_crop(client, bbox).await?;
    let encoded = BASE64_STANDARD.encode(image_bytes);

    let body = serde_json::json!({
        "model": ollama_model(),
        "messages": [{
            "role": "user",
            "content": SPLIT_LINE_INSTRUCTIONS,
            "images": [encoded],
        }],
        "stream": false,
        "format": "json",
        "options": { "temperature": 0.1, "top_p": 0.9 },
    });

    let url = format!("{}/api/chat", ollama_host().trim_end_matches('/'));
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        let snippet: String = body_text.chars().take(300).collect();
        return Err(AppError::OllamaRequest(format!("HTTP {status}: {snippet}")));
    }

    let parsed: OllamaChatResponse = response.json().await.map_err(AppError::Network)?;
    let payload: SplitSuggestionPayload =
        serde_json::from_str(extract_json_object(&parsed.message.content)).map_err(|err| {
            let snippet: String = parsed.message.content.chars().take(300).collect();
            AppError::OllamaRequest(format!(
                "respuesta no es el JSON esperado ({err}): {snippet}"
            ))
        })?;

    let (Some(point1), Some(point2)) = (payload.punto1, payload.punto2) else {
        return Err(AppError::OllamaRequest(
            "la IA no devolvió los dos puntos de la línea".to_string(),
        ));
    };
    if !point1.is_valid() || !point2.is_valid() {
        return Err(AppError::OllamaRequest(
            "la IA devolvió puntos fuera del rango 0-1".to_string(),
        ));
    }

    Ok(SuggestedSplit {
        suggested_line: [
            fraction_to_lnglat(point1, bbox),
            fraction_to_lnglat(point2, bbox),
        ],
        note: payload.nota,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_corner_fractions_to_bbox_corners() {
        let bbox = [-77.10, -12.05, -77.09, -12.04];
        let top_left = fraction_to_lnglat(FractionalPoint { x: 0.0, y: 0.0 }, bbox);
        assert!((top_left[0] - (-77.10)).abs() < 1e-9);
        assert!((top_left[1] - (-12.04)).abs() < 1e-9);

        let bottom_right = fraction_to_lnglat(FractionalPoint { x: 1.0, y: 1.0 }, bbox);
        assert!((bottom_right[0] - (-77.09)).abs() < 1e-9);
        assert!((bottom_right[1] - (-12.05)).abs() < 1e-9);
    }

    #[test]
    fn converts_center_fraction_to_bbox_center() {
        let bbox = [0.0, 0.0, 10.0, 20.0];
        let center = fraction_to_lnglat(FractionalPoint { x: 0.5, y: 0.5 }, bbox);
        assert!((center[0] - 5.0).abs() < 1e-9);
        assert!((center[1] - 10.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_out_of_range_fractions() {
        assert!(!FractionalPoint { x: 1.5, y: 0.5 }.is_valid());
        assert!(!FractionalPoint { x: 0.5, y: -0.1 }.is_valid());
        assert!(FractionalPoint { x: 0.0, y: 1.0 }.is_valid());
    }

    #[test]
    fn extracts_two_points_and_note_from_markdown_fenced_json() {
        let content = "```json\n{\"punto1\":{\"x\":0.3,\"y\":0.5},\"punto2\":{\"x\":0.3,\"y\":0.9},\"nota\":\"cambio de techo\"}\n```";
        let payload: SplitSuggestionPayload =
            serde_json::from_str(extract_json_object(content)).unwrap();
        assert_eq!(payload.punto1.unwrap().x, 0.3);
        assert_eq!(payload.punto2.unwrap().y, 0.9);
        assert_eq!(payload.nota.as_deref(), Some("cambio de techo"));
    }
}
