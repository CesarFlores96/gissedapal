//! Generacion del `.xlsx` de una ejecucion.
//!
//! El libro se arma en la PC, no en el backend: la carpeta de fotos es local,
//! el destino es local. Las filas se consultan en AWS; requiere conexión para
//! verificar que todos los resultados procesados ya estén guardados.
//!
//! [`ExcelRow`] tiene **exactamente** los diez campos del informe. Esa es la
//! garantia de que la exportacion no puede filtrar el modelo, el prompt, las
//! dimensiones de la imagen ni la API key: no hay donde ponerlos. Un filtro en
//! tiempo de ejecucion se puede olvidar en una edicion futura; un struct de
//! diez campos no compila si alguien lo intenta.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use rust_xlsxwriter::{Format, FormatAlign, Workbook};
use serde_json::Value;

use crate::{meter_consolidation::SupplyConsolidatedReport, AppError};

/// Una fila del Excel. Diez campos, ni uno mas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExcelRow {
    pub(crate) archivo: String,
    pub(crate) ruta: String,
    pub(crate) numero_medidor: String,
    pub(crate) lectura: String,
    pub(crate) estado_conexion: String,
    pub(crate) estado_medidor: String,
    pub(crate) observacion: String,
    pub(crate) requiere_revision: String,
    pub(crate) estado_procesamiento: String,
    pub(crate) error: String,
}

const HEADERS: [&str; 10] = [
    "Archivo",
    "Ruta",
    "Número de medidor",
    "Lectura",
    "Estado de conexión",
    "Estado del medidor",
    "Observación",
    "Requiere revisión",
    "Estado de procesamiento",
    "Error",
];

/// Ancho de cada columna, en caracteres. Las descriptivas necesitan aire o el
/// archivo se abre con todo cortado y hay que redimensionar a mano.
const WIDTHS: [f64; 10] = [28.0, 52.0, 20.0, 14.0, 34.0, 34.0, 40.0, 16.0, 20.0, 40.0];

fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn estado_legible(status: &str) -> String {
    match status {
        "done" => "Procesado",
        "error" => "Error",
        "needs_attention" => "Requiere revisión",
        "cancelled" => "Cancelado",
        "processing" => "En proceso",
        "pending" => "Pendiente",
        other => other,
    }
    .to_string()
}

/// Traduce una fila persistida (snake_case, como la devuelve el backend) a la
/// fila del Excel.
pub(crate) fn row_from_record(record: &Value) -> ExcelRow {
    let status = text(record.get("status"));
    ExcelRow {
        archivo: text(record.get("file_name")),
        ruta: text(record.get("file_path")),
        numero_medidor: text(record.get("numero_medidor")),
        lectura: text(record.get("lectura")),
        estado_conexion: text(record.get("estado_conexion")),
        estado_medidor: text(record.get("estado_medidor")),
        observacion: text(record.get("observacion")),
        requiere_revision: match record.get("requiere_revision").and_then(Value::as_bool) {
            Some(true) => "Sí".to_string(),
            Some(false) => "No".to_string(),
            None => String::new(),
        },
        estado_procesamiento: estado_legible(&status),
        error: text(record.get("error_message")),
    }
}

impl ExcelRow {
    fn cells(&self) -> [&str; 10] {
        [
            &self.archivo,
            &self.ruta,
            &self.numero_medidor,
            &self.lectura,
            &self.estado_conexion,
            &self.estado_medidor,
            &self.observacion,
            &self.requiere_revision,
            &self.estado_procesamiento,
            &self.error,
        ]
    }
}

/// Arma el libro en memoria. No toca el disco: quien elige donde guardar es el
/// comando, con el dialogo nativo.
#[allow(dead_code)]
pub(crate) fn build_workbook(
    rows: &[ExcelRow],
    sheet_name: &str,
    freeze_header: bool,
    autofilter: bool,
) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();

    // Excel rechaza nombres de hoja de mas de 31 caracteres o con caracteres
    // reservados; el nombre viene de la base, asi que se sanea aca.
    let safe_name: String = sheet_name
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
        .take(31)
        .collect();
    if !safe_name.trim().is_empty() {
        sheet
            .set_name(safe_name.trim())
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    let header_format = Format::new()
        .set_bold()
        .set_align(FormatAlign::Left)
        .set_background_color(0x1F4E79)
        .set_font_color(0xFFFFFF);
    let wrap_format = Format::new().set_text_wrap().set_align(FormatAlign::Top);

    for (index, header) in HEADERS.iter().enumerate() {
        let column = u16::try_from(index)
            .map_err(|_| AppError::ExcelExport("índice de columna fuera de rango".to_string()))?;
        sheet
            .write_string_with_format(0, column, *header, &header_format)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        let width = WIDTHS.get(index).copied().unwrap_or(20.0);
        sheet
            .set_column_width(column, width)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    for (row_index, row) in rows.iter().enumerate() {
        // +1 por el encabezado. `u32::try_from` en vez de `as`: un lote enorme
        // no debe truncar silenciosamente y escribir sobre otra fila.
        let excel_row = u32::try_from(row_index + 1)
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        for (column_index, cell) in row.cells().iter().enumerate() {
            let column = u16::try_from(column_index).map_err(|_| {
                AppError::ExcelExport("índice de columna fuera de rango".to_string())
            })?;
            sheet
                .write_string_with_format(excel_row, column, *cell, &wrap_format)
                .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        }
    }

    if freeze_header {
        sheet
            .set_freeze_panes(1, 0)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }
    if autofilter && !rows.is_empty() {
        let last_row = u32::try_from(rows.len())
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        sheet
            .autofilter(0, 0, last_row, 9)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    workbook
        .save_to_buffer()
        .map_err(|err| AppError::ExcelExport(err.to_string()))
}

pub(crate) const CONSOLIDATED_HEADERS: [&str; 12] = [
    "Suministro (NIS)",
    "Medidor encontrado",
    "Lectura visible",
    "Lectura",
    "Número de medidor",
    "Estado del medidor",
    "Estado de la conexión",
    "Incidencias detectadas",
    "Nivel de criticidad",
    "Descripción del nivel",
    "Conclusión consolidada",
    "Acción sugerida",
];

const CONSOLIDATED_WIDTHS: [f64; 12] = [
    18.0, 18.0, 16.0, 16.0, 20.0, 32.0, 32.0, 38.0, 16.0, 24.0, 48.0, 28.0,
];

/// Arma el libro Excel con hoja 1 "Consolidado Suministros" y hoja 2 "Detalle Fotografías".
pub(crate) fn build_consolidated_workbook(
    consolidated: &[SupplyConsolidatedReport],
    rows: &[ExcelRow],
    detail_sheet_name: &str,
    freeze_header: bool,
    autofilter: bool,
) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();

    let header_format = Format::new()
        .set_bold()
        .set_align(FormatAlign::Left)
        .set_background_color(0x1F4E79)
        .set_font_color(0xFFFFFF);
    let wrap_format = Format::new().set_text_wrap().set_align(FormatAlign::Top);

    // -----------------------------------------------------------------------
    // Hoja 1: Consolidado por Suministro
    // -----------------------------------------------------------------------
    let sheet_cons = workbook.add_worksheet();
    sheet_cons
        .set_name("Consolidado Suministros")
        .map_err(|err| AppError::ExcelExport(err.to_string()))?;

    for (index, header) in CONSOLIDATED_HEADERS.iter().enumerate() {
        let column = u16::try_from(index)
            .map_err(|_| AppError::ExcelExport("índice de columna fuera de rango".to_string()))?;
        sheet_cons
            .write_string_with_format(0, column, *header, &header_format)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        let width = CONSOLIDATED_WIDTHS.get(index).copied().unwrap_or(20.0);
        sheet_cons
            .set_column_width(column, width)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    for (row_idx, item) in consolidated.iter().enumerate() {
        let excel_row = u32::try_from(row_idx + 1)
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        let incs = item.incidencias_detectadas.join("; ");
        let crit_str = item.nivel_criticidad.to_string();

        let cells: [&str; 12] = [
            &item.suministro,
            &item.medidor_encontrado,
            &item.lectura_visible,
            &item.lectura,
            &item.numero_medidor,
            &item.estado_medidor,
            &item.estado_conexion,
            &incs,
            &crit_str,
            &item.descripcion_nivel,
            &item.conclusion_consolidada,
            &item.accion_sugerida,
        ];

        for (col_idx, cell) in cells.iter().enumerate() {
            let column = u16::try_from(col_idx).map_err(|_| {
                AppError::ExcelExport("índice de columna fuera de rango".to_string())
            })?;
            sheet_cons
                .write_string_with_format(excel_row, column, *cell, &wrap_format)
                .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        }
    }

    if freeze_header {
        sheet_cons
            .set_freeze_panes(1, 0)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }
    if autofilter && !consolidated.is_empty() {
        let last_row = u32::try_from(consolidated.len())
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        sheet_cons
            .autofilter(0, 0, last_row, 11)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    // -----------------------------------------------------------------------
    // Hoja 2: Detalle por Fotografía
    // -----------------------------------------------------------------------
    let sheet_det = workbook.add_worksheet();
    let safe_name: String = detail_sheet_name
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
        .take(31)
        .collect();
    let final_name = if safe_name.trim().is_empty() || safe_name.trim() == "Consolidado Suministros"
    {
        "Detalle Fotografías".to_string()
    } else {
        safe_name.trim().to_string()
    };
    sheet_det
        .set_name(&final_name)
        .map_err(|err| AppError::ExcelExport(err.to_string()))?;

    for (index, header) in HEADERS.iter().enumerate() {
        let column = u16::try_from(index)
            .map_err(|_| AppError::ExcelExport("índice de columna fuera de rango".to_string()))?;
        sheet_det
            .write_string_with_format(0, column, *header, &header_format)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        let width = WIDTHS.get(index).copied().unwrap_or(20.0);
        sheet_det
            .set_column_width(column, width)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    for (row_index, row) in rows.iter().enumerate() {
        let excel_row = u32::try_from(row_index + 1)
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        for (column_index, cell) in row.cells().iter().enumerate() {
            let column = u16::try_from(column_index).map_err(|_| {
                AppError::ExcelExport("índice de columna fuera de rango".to_string())
            })?;
            sheet_det
                .write_string_with_format(excel_row, column, *cell, &wrap_format)
                .map_err(|err| AppError::ExcelExport(err.to_string()))?;
        }
    }

    if freeze_header {
        sheet_det
            .set_freeze_panes(1, 0)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }
    if autofilter && !rows.is_empty() {
        let last_row = u32::try_from(rows.len())
            .map_err(|_| AppError::ExcelExport("demasiadas filas".to_string()))?;
        sheet_det
            .autofilter(0, 0, last_row, 9)
            .map_err(|err| AppError::ExcelExport(err.to_string()))?;
    }

    workbook
        .save_to_buffer()
        .map_err(|err| AppError::ExcelExport(err.to_string()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(archivo: &str) -> ExcelRow {
        ExcelRow {
            archivo: archivo.to_string(),
            ruta: format!("C:/fotos/{archivo}"),
            numero_medidor: "A-4471".to_string(),
            lectura: "001234".to_string(),
            estado_conexion: "Sin incidencia de conexión visible.".to_string(),
            estado_medidor: "Medidor en buen estado.".to_string(),
            observacion: "Tapa con tierra.".to_string(),
            requiere_revision: "No".to_string(),
            estado_procesamiento: "Procesado".to_string(),
            error: String::new(),
        }
    }

    #[test]
    fn produce_un_xlsx_valido() {
        let bytes = build_workbook(&[sample("a.jpg")], "Analisis", true, true).expect("libro");
        assert!(bytes.len() > 100);
        // Firma de un zip: todo .xlsx lo es.
        assert_eq!(bytes.get(0..4), Some(&b"PK\x03\x04"[..]));
    }

    #[test]
    fn exporta_muestra_para_verificacion_independiente() {
        let Some(path) = std::env::var_os("METER_XLSX_TEST_OUTPUT") else {
            return;
        };
        let mut zero = sample("ceros.jpg");
        zero.lectura = "00000".to_string();
        let error = row_from_record(
            &json!({ "file_name": "error.jpg", "file_path": "C:/fotos/error.jpg", "status": "error", "error_message": "Imagen no legible" }),
        );
        let bytes = build_workbook(&[sample("serie.jpg"), zero, error], "Análisis", true, true)
            .expect("libro");
        std::fs::write(path, bytes).expect("archivo de prueba");
    }

    #[test]
    fn un_libro_sin_filas_sigue_siendo_valido() {
        let bytes = build_workbook(&[], "Analisis", true, true).expect("libro");
        assert_eq!(bytes.get(0..4), Some(&b"PK\x03\x04"[..]));
    }

    #[test]
    fn la_fila_tiene_exactamente_diez_celdas() {
        assert_eq!(sample("a.jpg").cells().len(), HEADERS.len());
        assert_eq!(HEADERS.len(), 10);
    }

    #[test]
    fn una_foto_con_error_conserva_su_fila_y_su_mensaje() {
        let record = json!({
            "file_name": "rota.jpg",
            "file_path": "C:/fotos/rota.jpg",
            "numero_medidor": null,
            "lectura": null,
            "estado_conexion": null,
            "estado_medidor": null,
            "observacion": null,
            "requiere_revision": true,
            "status": "error",
            "error_message": "no se pudo leer la imagen",
        });
        let row = row_from_record(&record);
        assert_eq!(row.archivo, "rota.jpg");
        assert_eq!(row.estado_procesamiento, "Error");
        assert_eq!(row.error, "no se pudo leer la imagen");
        assert_eq!(row.numero_medidor, "");
        assert_eq!(row.requiere_revision, "Sí");
    }

    #[test]
    fn traduce_el_estado_a_texto_para_el_usuario() {
        assert_eq!(estado_legible("done"), "Procesado");
        assert_eq!(estado_legible("cancelled"), "Cancelado");
        assert_eq!(estado_legible("needs_attention"), "Requiere revisión");
        assert_eq!(estado_legible("rarito"), "rarito");
    }

    #[test]
    fn sanea_un_nombre_de_hoja_invalido() {
        // Excel rechaza estos caracteres; el nombre viene de la base.
        let bytes =
            build_workbook(&[sample("a.jpg")], "An/al:isis*[2026]", false, false).expect("libro");
        assert_eq!(bytes.get(0..4), Some(&b"PK\x03\x04"[..]));
    }

    #[test]
    fn produce_un_libro_consolidado_con_dos_hojas() {
        use crate::meter_consolidation::{CriticalityLevel, SupplyConsolidatedReport};

        let cons = SupplyConsolidatedReport {
            suministro: "2653638".to_string(),
            total_fotos: 2,
            fotos_validas: 2,
            fotos_no_concluyentes: 0,
            fotos_no_relacionadas: 0,
            medidor_encontrado: "Sí".to_string(),
            lectura_visible: "Sí".to_string(),
            numero_medidor: "DB12345".to_string(),
            lectura: "00120".to_string(),
            estado_medidor: "Visible".to_string(),
            estado_conexion: "Inundada".to_string(),
            incidencias_detectadas: vec!["Caja inundada".to_string()],
            nivel_criticidad: CriticalityLevel::Nivel1Critico.as_u8(),
            descripcion_nivel: "Crítico".to_string(),
            conclusion_consolidada: "Caja de conexión inundada".to_string(),
            accion_sugerida: "Atención inmediata".to_string(),
            fotos: vec![],
        };
        let rows = vec![sample("2653638_1.jpg"), sample("2653638_2.jpg")];
        let bytes = build_consolidated_workbook(&[cons], &rows, "Detalle", true, true)
            .expect("libro consolidado");
        assert_eq!(bytes.get(0..4), Some(&b"PK\x03\x04"[..]));
        assert_eq!(CONSOLIDATED_HEADERS.len(), 12);
        assert!(!CONSOLIDATED_HEADERS.contains(&"Total fotos"));
        assert!(!CONSOLIDATED_HEADERS.contains(&"Fotos válidas"));
    }
}
