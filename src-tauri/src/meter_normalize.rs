//! Capa determinista de consistencia sobre la respuesta del modelo.
//!
//! El modelo multimodal propone; esta capa decide. Todo lo que sale de acá es
//! lo que ve el usuario, lo que se persiste y lo que va al Excel; la respuesta
//! cruda queda solo como auditoría interna.
//!
//! Existe porque un modelo de visión se contradice de formas predecibles:
//! transcribe la serie del contador en `numero_medidor`, o declara "Medidor Con
//! Lectura Imposible" en la misma respuesta donde transcribió una lectura de
//! seis dígitos. Corregir eso con reglas fijas es más barato y mucho más
//! auditable que insistirle al prompt.
//!
//! Cada corrección aplicada queda registrada como un [`Adjustment`] con código
//! estable, que se persiste en `photo_analysis_results.post_process_applied`.
//! Los tests verifican la salida **y** el rastro.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use serde::{Deserialize, Serialize};

/// Centinela único para "no se observa". El prompt lo pide en este formato y
/// la normalización colapsa cualquier variante a este valor exacto, para que
/// filtros, grafo y Excel no tengan que conocer seis sinónimos.
pub(crate) const NO_VISIBLE: &str = "No visible";

pub(crate) const SIN_INCIDENCIA_CONEXION: &str = "Sin incidencia de conexión visible.";
pub(crate) const MEDIDOR_EN_BUEN_ESTADO: &str =
    "Medidor en buen estado; lectura legible y sin incidencias visibles.";

pub(crate) const CAJA_AVERIADA_SIN_LECTURA: &str = "Caja Averiada Sin Lectura";
pub(crate) const CAJA_AVERIADA_CON_LECTURA: &str = "Caja Averiada Con Lectura";

/// Frases que no pueden convivir con una lectura numérica legible.
const CONTRADICCIONES_CON_LECTURA: [&str; 3] = [
    "Caja Averiada Sin Lectura",
    "Medidor Con Lectura Imposible",
    "Medidor No Encontrado",
];

/// Variantes que el modelo usa para decir "no se ve".
const SINONIMOS_NO_VISIBLE: [&str; 8] = [
    "",
    "no visible",
    "no se ve",
    "no se observa",
    "n/a",
    "na",
    "null",
    "ninguno",
];

/// Lo que el modelo devolvió, antes de tocar nada.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct RawReport {
    #[serde(default)]
    pub(crate) numero_medidor: Option<String>,
    #[serde(default)]
    pub(crate) lectura: Option<String>,
    #[serde(default)]
    pub(crate) estado_conexion: Option<String>,
    #[serde(default)]
    pub(crate) estado_medidor: Option<String>,
    #[serde(default)]
    pub(crate) observacion: Option<String>,
    #[serde(default)]
    pub(crate) requiere_revision: Option<bool>,
}

/// El informe validado: lo único que ve el usuario.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeterReport {
    pub(crate) numero_medidor: String,
    pub(crate) lectura: String,
    pub(crate) estado_conexion: String,
    pub(crate) estado_medidor: String,
    pub(crate) observacion: String,
    pub(crate) requiere_revision: bool,
}

/// Qué corrigió la capa de consistencia. Se persiste como texto para poder
/// auditar después por qué un informe difiere de lo que dijo el modelo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Adjustment {
    /// Una secuencia numérica estaba en `numero_medidor` y `lectura` vacía.
    MovedSerialToReading,
    /// Se quitó una frase incompatible con una lectura numérica.
    StrippedContradiction(&'static str),
    /// Lectura de solo ceros: se fijó la frase de "no registra".
    AllZeroReading(usize),
    /// Se eliminó "Dudoso", que el prompt prohíbe explícitamente.
    RemovedDudoso,
    RejectedAmbiguousReading,
    /// `requiere_revision` del modelo no coincidía con el estado final.
    RecomputedReview,
    /// "Caja Averiada Sin Lectura" con lectura legible pasó a "Con Lectura".
    BoxDamageKeptWithReading,
}

impl Adjustment {
    pub(crate) fn code(&self) -> String {
        match self {
            Self::MovedSerialToReading => "moved_serial_to_reading".to_string(),
            Self::StrippedContradiction(frase) => {
                format!("stripped_contradiction:{}", slug(frase))
            }
            Self::AllZeroReading(count) => format!("all_zero_reading:{count}"),
            Self::RemovedDudoso => "removed_dudoso".to_string(),
            Self::RejectedAmbiguousReading => "rejected_ambiguous_reading".to_string(),
            Self::RecomputedReview => "recomputed_review".to_string(),
            Self::BoxDamageKeptWithReading => "box_damage_kept_with_reading".to_string(),
        }
    }
}

fn slug(value: &str) -> String {
    fold(value).replace(' ', "-")
}

/// Minúsculas sin tildes, para comparar sin depender de cómo acentuó el modelo.
fn fold(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'Á' | 'À' | 'Ä' | 'Â' => 'a',
            'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
            'ñ' | 'Ñ' => 'n',
            other => other.to_ascii_lowercase(),
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Colapsa espacios internos sin tocar mayúsculas ni tildes.
fn tidy(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_sentinel(value: Option<&String>) -> String {
    let raw = value.map(String::as_str).unwrap_or("");
    let tidied = tidy(raw);
    let folded = fold(&tidied);
    if SINONIMOS_NO_VISIBLE.contains(&folded.as_str()) {
        return NO_VISIBLE.to_string();
    }
    tidied
}

/// Solo dígitos y espacios. Un punto o coma puede separar los decimales rojos:
/// nunca se concatenan con las ruedas negras por suposición.
pub(crate) fn is_numeric_sequence(value: &str) -> bool {
    let digits: String = value.chars().filter(|c| !c.is_whitespace()).collect();
    !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
}

/// Devuelve solo los dígitos, conservando el orden y **todos** los ceros.
fn digits_only(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}

fn is_missing(value: &str) -> bool {
    value == NO_VISIBLE || value.is_empty()
}

/// Quita una frase de un texto, sin distinguir mayúsculas ni tildes, y limpia
/// los separadores que quedan huérfanos.
fn strip_phrase(haystack: &str, needle: &str) -> Option<String> {
    let folded_haystack = fold(haystack);
    let folded_needle = fold(needle);
    if folded_needle.is_empty() || !folded_haystack.contains(&folded_needle) {
        return None;
    }
    // Se reconstruye sobre el texto plegado y luego se limpia: preservar el
    // casing original de lo que sobra no vale la complejidad, porque lo que
    // sobra casi siempre es un separador o una frase de relleno.
    let remainder = folded_haystack.replace(&folded_needle, " ");
    let cleaned = remainder
        .split([',', ';', '.'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(". ");
    Some(tidy(&cleaned))
}

fn contains_dudoso(value: &str) -> bool {
    fold(value).contains("dudoso")
}

/// Frase exacta pedida para una lectura compuesta solo por ceros.
fn frase_lectura_en_ceros(lectura: &str) -> String {
    format!(
        "Medidor no registra, ya que su lectura es de {lectura} y se ven tuberías y una unión, pero la foto no permite confirmar su funcionamiento."
    )
}

/// Aplica todas las reglas de consistencia. Determinista, sin E/S y sin reloj.
///
/// El orden importa y está fijado por los tests: mover la serie a la lectura
/// **antes** de resolver contradicciones, porque la regla de contradicción
/// depende de que exista una lectura numérica.
pub(crate) fn normalize_report(raw: &RawReport) -> (MeterReport, Vec<Adjustment>) {
    let mut adjustments: Vec<Adjustment> = Vec::new();

    // 1. Centinelas y espacios.
    let mut numero_medidor = normalize_sentinel(raw.numero_medidor.as_ref());
    let mut lectura = normalize_sentinel(raw.lectura.as_ref());
    let mut estado_conexion = normalize_sentinel(raw.estado_conexion.as_ref());
    let mut estado_medidor = normalize_sentinel(raw.estado_medidor.as_ref());
    let mut observacion = normalize_sentinel(raw.observacion.as_ref());

    // 2. Regla A: las ruedas del contador nunca son el número de medidor.
    if is_numeric_sequence(&numero_medidor) && is_missing(&lectura) {
        lectura = digits_only(&numero_medidor);
        numero_medidor = NO_VISIBLE.to_string();
        adjustments.push(Adjustment::MovedSerialToReading);
    }

    if !is_missing(&lectura) && !is_numeric_sequence(&lectura) {
        lectura = NO_VISIBLE.to_string();
        adjustments.push(Adjustment::RejectedAmbiguousReading);
    } else if is_numeric_sequence(&lectura) {
        lectura = digits_only(&lectura);
    }

    let lectura_numerica = !is_missing(&lectura) && is_numeric_sequence(&lectura);

    // 3. Una caja averiada sigue estando averiada aunque se haya podido leer:
    //    lo que contradice a la lectura es el "Sin Lectura", no el daño. Antes
    //    esto se eliminaba junto con el resto de contradicciones y el informe
    //    perdía la incidencia, quedando como si la conexión estuviera sana.
    if lectura_numerica && fold(&estado_conexion).contains(&fold(CAJA_AVERIADA_SIN_LECTURA)) {
        estado_conexion = CAJA_AVERIADA_CON_LECTURA.to_string();
        adjustments.push(Adjustment::BoxDamageKeptWithReading);
    }

    // 4. Regla B: con lectura numérica, ciertas incidencias son imposibles.
    if lectura_numerica {
        for frase in CONTRADICCIONES_CON_LECTURA {
            for campo in [&mut estado_conexion, &mut estado_medidor, &mut observacion] {
                if let Some(limpio) = strip_phrase(campo, frase) {
                    *campo = if frase == "Caja Averiada Sin Lectura" {
                        format!("Caja Averiada Con Lectura. {limpio}")
                            .trim()
                            .to_string()
                    } else {
                        limpio
                    };
                    adjustments.push(Adjustment::StrippedContradiction(frase));
                }
            }
        }
    }

    const REVIEW_NOTE: &str = "Revisión pendiente por inconsistencias en el informe.";
    if adjustments.iter().any(|item| {
        matches!(
            item,
            Adjustment::StrippedContradiction(_) | Adjustment::RejectedAmbiguousReading
        )
    }) && !observacion.contains(REVIEW_NOTE)
    {
        observacion = if observacion == NO_VISIBLE {
            REVIEW_NOTE.to_string()
        } else {
            format!("{observacion} {REVIEW_NOTE}")
        };
    }

    // 5. Regla C: lectura de solo ceros, conservando la cantidad exacta.
    let digitos = digits_only(&lectura);
    let solo_ceros = lectura_numerica && !digitos.is_empty() && digitos.chars().all(|c| c == '0');
    if solo_ceros {
        estado_conexion = frase_lectura_en_ceros(&digitos);
        lectura = digitos.clone();
        adjustments.push(Adjustment::AllZeroReading(digitos.len()));
    }

    // 6. Regla D: "Dudoso" está prohibido en todos los campos.
    for campo in [
        &mut numero_medidor,
        &mut lectura,
        &mut estado_conexion,
        &mut estado_medidor,
        &mut observacion,
    ] {
        if contains_dudoso(campo) {
            *campo = strip_phrase(campo, "dudoso").unwrap_or_default();
            adjustments.push(Adjustment::RemovedDudoso);
        }
    }

    // 7. Rellenos por defecto para los campos que quedaron vacíos.
    if estado_conexion.is_empty() || estado_conexion == NO_VISIBLE {
        estado_conexion = if lectura_numerica && !solo_ceros {
            SIN_INCIDENCIA_CONEXION.to_string()
        } else if solo_ceros {
            frase_lectura_en_ceros(&digitos)
        } else {
            SIN_INCIDENCIA_CONEXION.to_string()
        };
    }
    if estado_medidor.is_empty() || estado_medidor == NO_VISIBLE {
        estado_medidor = NO_VISIBLE.to_string();
    }
    if observacion.is_empty() {
        observacion = NO_VISIBLE.to_string();
    }

    // 8. Regla E: la revisión se recalcula; no se confía en el modelo.
    let requiere_revision = compute_review(&lectura, &estado_conexion, &estado_medidor)
        || observacion.contains(REVIEW_NOTE);
    if raw.requiere_revision != Some(requiere_revision) {
        adjustments.push(Adjustment::RecomputedReview);
    }

    (
        MeterReport {
            numero_medidor,
            lectura,
            estado_conexion,
            estado_medidor,
            observacion,
            requiere_revision,
        },
        adjustments,
    )
}

/// `No` solo cuando hay lectura legible y ninguna incidencia visible.
fn compute_review(lectura: &str, estado_conexion: &str, estado_medidor: &str) -> bool {
    if is_missing(lectura) || !is_numeric_sequence(lectura) {
        return true;
    }
    let conexion_limpia = fold(estado_conexion) == fold(SIN_INCIDENCIA_CONEXION);
    let medidor_limpio = fold(estado_medidor) == fold(MEDIDOR_EN_BUEN_ESTADO);
    !(conexion_limpia && medidor_limpio)
}

/// Sustituye `{{etiquetas}}` y `{{reglas}}` en el cuerpo del prompt activo.
///
/// Un placeholder ausente no es un error: el prompt lo edita el usuario desde
/// la app y puede decidir no inyectar una de las dos listas.
pub(crate) fn render_prompt(body: &str, etiquetas: &[String], reglas: &[String]) -> String {
    let etiquetas_txt = render_list(etiquetas, "No hay etiquetas configuradas.");
    let reglas_txt = render_list(reglas, "No hay reglas configuradas.");
    body.replace("{{etiquetas}}", &etiquetas_txt)
        .replace("{{reglas}}", &reglas_txt)
}

fn render_list(items: &[String], vacio: &str) -> String {
    if items.is_empty() {
        return vacio.to_string();
    }
    items
        .iter()
        .map(|item| format!("- {}", tidy(item)))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    fn raw(numero: &str, lectura: &str, conexion: &str, medidor: &str) -> RawReport {
        RawReport {
            numero_medidor: Some(numero.to_string()),
            lectura: Some(lectura.to_string()),
            estado_conexion: Some(conexion.to_string()),
            estado_medidor: Some(medidor.to_string()),
            observacion: Some("Tapa con tierra.".to_string()),
            requiere_revision: Some(false),
        }
    }

    fn codes(adjustments: &[Adjustment]) -> Vec<String> {
        adjustments.iter().map(Adjustment::code).collect()
    }

    #[test]
    fn mueve_la_secuencia_del_contador_a_lectura() {
        let (report, adj) = normalize_report(&raw("00123456", "", "", ""));
        assert_eq!(report.numero_medidor, NO_VISIBLE);
        assert_eq!(report.lectura, "00123456");
        assert!(codes(&adj).contains(&"moved_serial_to_reading".to_string()));
    }

    #[test]
    fn no_mueve_la_serie_si_la_lectura_ya_tiene_digitos() {
        let (report, adj) = normalize_report(&raw("A-4471", "001234", "", ""));
        assert_eq!(report.numero_medidor, "A-4471");
        assert_eq!(report.lectura, "001234");
        assert!(!codes(&adj).contains(&"moved_serial_to_reading".to_string()));
    }

    #[test]
    fn con_lectura_numerica_desaparece_el_sin_lectura_pero_no_el_dano() {
        // Contrato actualizado: antes la frase se eliminaba entera y el informe
        // perdía la incidencia. Lo que contradice a una lectura legible es el
        // "Sin Lectura", no que la caja esté averiada.
        let (report, _) = normalize_report(&raw("A-1", "001234", "Caja Averiada Sin Lectura", ""));
        assert!(!fold(&report.estado_conexion).contains("sin lectura"));
        assert!(fold(&report.estado_conexion).contains("caja averiada"));
    }

    #[test]
    fn con_lectura_numerica_elimina_lectura_imposible_y_no_encontrado() {
        let (report, adj) = normalize_report(&raw(
            "A-1",
            "001234",
            "Medidor No Encontrado",
            "Medidor Con Lectura Imposible",
        ));
        assert!(!fold(&report.estado_medidor).contains("lectura imposible"));
        assert!(!fold(&report.estado_conexion).contains("no encontrado"));
        assert_eq!(
            codes(&adj)
                .iter()
                .filter(|code| code.starts_with("stripped_contradiction"))
                .count(),
            2
        );
    }

    #[test]
    fn reconoce_las_contradicciones_sin_tildes_ni_mayusculas() {
        let (report, adj) = normalize_report(&raw(
            "A-1",
            "001234",
            "caja averiada sin lectura",
            "MEDIDOR CON LECTURA IMPOSIBLE",
        ));
        assert!(!fold(&report.estado_conexion).contains("sin lectura"));
        assert!(!fold(&report.estado_medidor).contains("lectura imposible"));
        // Ambas se reconocen pese a las tildes y mayúsculas, pero se resuelven
        // distinto: la caja averiada se convierte (conserva la incidencia) y la
        // lectura imposible se elimina (es imposible con lectura legible).
        assert!(fold(&report.estado_conexion).contains("caja averiada"));
        let aplicados = codes(&adj);
        assert!(aplicados.contains(&"box_damage_kept_with_reading".to_string()));
        assert_eq!(
            aplicados
                .iter()
                .filter(|code| code.starts_with("stripped_contradiction"))
                .count(),
            1
        );
    }

    #[test]
    fn una_caja_averiada_con_lectura_conserva_la_incidencia() {
        // El "Sin Lectura" contradice a la lectura; el daño de la caja no. Antes
        // se eliminaba la frase entera y el informe decía que la conexión estaba
        // sana, perdiendo la incidencia.
        let (report, adj) =
            normalize_report(&raw("A-1", "001234", "Caja Averiada Sin Lectura", ""));
        assert_eq!(report.estado_conexion, CAJA_AVERIADA_CON_LECTURA);
        assert!(codes(&adj).contains(&"box_damage_kept_with_reading".to_string()));
        assert!(report.requiere_revision, "una caja averiada exige revisión");
    }

    #[test]
    fn sin_lectura_la_caja_averiada_queda_como_esta() {
        let (report, _) =
            normalize_report(&raw("A-1", "No visible", "Caja Averiada Sin Lectura", ""));
        assert_eq!(report.estado_conexion, CAJA_AVERIADA_SIN_LECTURA);
    }

    #[test]
    fn conserva_la_cantidad_exacta_de_ceros() {
        for (entrada, esperado) in [("00000", 5), ("000", 3), ("0", 1)] {
            let (report, adj) = normalize_report(&raw("A-1", entrada, "", ""));
            assert_eq!(report.lectura, entrada, "lectura {entrada}");
            assert!(report.estado_conexion.contains(entrada), "frase {entrada}");
            assert!(codes(&adj).contains(&format!("all_zero_reading:{esperado}")));
        }
    }

    #[test]
    fn una_lectura_con_ceros_a_la_izquierda_no_es_lectura_en_ceros() {
        let (report, adj) = normalize_report(&raw("A-1", "00123", "", ""));
        assert_eq!(report.lectura, "00123");
        assert!(!codes(&adj).iter().any(|code| code.starts_with("all_zero")));
        assert_eq!(report.estado_conexion, SIN_INCIDENCIA_CONEXION);
    }

    #[test]
    fn dudoso_nunca_sobrevive_en_ningun_campo() {
        let mut entrada = raw("Dudoso", "Dudoso", "Dudoso", "Dudoso");
        entrada.observacion = Some("Dudoso".to_string());
        let (report, adj) = normalize_report(&entrada);
        for campo in [
            &report.numero_medidor,
            &report.lectura,
            &report.estado_conexion,
            &report.estado_medidor,
            &report.observacion,
        ] {
            assert!(!fold(campo).contains("dudoso"), "campo con dudoso: {campo}");
        }
        assert!(codes(&adj).contains(&"removed_dudoso".to_string()));
    }

    #[test]
    fn exige_revision_cuando_no_hay_lectura_legible() {
        let (report, _) = normalize_report(&raw("A-1", "No visible", "", ""));
        assert!(report.requiere_revision);
    }

    #[test]
    fn no_exige_revision_con_lectura_legible_y_sin_incidencias() {
        let (report, _) = normalize_report(&raw(
            "A-1",
            "001234",
            SIN_INCIDENCIA_CONEXION,
            MEDIDOR_EN_BUEN_ESTADO,
        ));
        assert!(!report.requiere_revision);
    }

    #[test]
    fn exige_revision_cuando_hay_una_incidencia_real() {
        let (report, _) = normalize_report(&raw("A-1", "001234", "Conexión Con Fuga", ""));
        assert!(report.requiere_revision);
    }

    #[test]
    fn un_informe_limpio_no_genera_ajustes() {
        let entrada = RawReport {
            numero_medidor: Some("A-4471".to_string()),
            lectura: Some("001234".to_string()),
            estado_conexion: Some(SIN_INCIDENCIA_CONEXION.to_string()),
            estado_medidor: Some(MEDIDOR_EN_BUEN_ESTADO.to_string()),
            observacion: Some("Tapa con tierra.".to_string()),
            requiere_revision: Some(false),
        };
        let (_, adj) = normalize_report(&entrada);
        assert!(adj.is_empty(), "ajustes inesperados: {:?}", codes(&adj));
    }

    #[test]
    fn normalizar_dos_veces_da_el_mismo_resultado() {
        let entrada = raw("00123456", "", "Caja Averiada Sin Lectura", "Dudoso");
        let (primero, _) = normalize_report(&entrada);
        let segundo_raw = RawReport {
            numero_medidor: Some(primero.numero_medidor.clone()),
            lectura: Some(primero.lectura.clone()),
            estado_conexion: Some(primero.estado_conexion.clone()),
            estado_medidor: Some(primero.estado_medidor.clone()),
            observacion: Some(primero.observacion.clone()),
            requiere_revision: Some(primero.requiere_revision),
        };
        let (segundo, adj) = normalize_report(&segundo_raw);
        assert_eq!(primero, segundo);
        assert!(adj.is_empty(), "segunda pasada ajustó: {:?}", codes(&adj));
    }

    #[test]
    fn colapsa_los_sinonimos_de_no_visible() {
        for variante in ["", "  ", "n/a", "No se ve", "NINGUNO"] {
            let entrada = raw(variante, "001234", "", "");
            let (report, _) = normalize_report(&entrada);
            assert_eq!(report.numero_medidor, NO_VISIBLE, "variante {variante:?}");
        }
    }

    #[test]
    fn inyecta_etiquetas_y_reglas_en_el_prompt() {
        let body = "A:\n{{etiquetas}}\nB:\n{{reglas}}";
        let salida = render_prompt(
            body,
            &["Caja Profunda".to_string()],
            &["No inventar".to_string()],
        );
        assert!(salida.contains("- Caja Profunda"));
        assert!(salida.contains("- No inventar"));
        assert!(!salida.contains("{{"));
    }

    #[test]
    fn el_prompt_tolera_placeholders_ausentes_o_repetidos() {
        let sin_reglas = render_prompt("solo {{etiquetas}}", &["X".to_string()], &[]);
        assert_eq!(sin_reglas, "solo - X");

        let repetido = render_prompt("{{etiquetas}} y {{etiquetas}}", &["X".to_string()], &[]);
        assert_eq!(repetido, "- X y - X");

        let sin_nada = render_prompt("sin placeholders", &[], &[]);
        assert_eq!(sin_nada, "sin placeholders");
    }

    #[test]
    fn una_lista_vacia_se_describe_en_vez_de_quedar_en_blanco() {
        let salida = render_prompt("{{etiquetas}}", &[], &[]);
        assert_eq!(salida, "No hay etiquetas configuradas.");
    }

    #[test]
    fn detecta_secuencias_numericas_con_separadores() {
        assert!(is_numeric_sequence("001 234"));
        assert!(!is_numeric_sequence("1.234"));
        assert!(!is_numeric_sequence("A-4471"));
        assert!(!is_numeric_sequence(""));
        assert!(!is_numeric_sequence("No visible"));
    }

    #[test]
    fn no_concatena_decimales_ni_inventa_el_estado_del_medidor() {
        let (decimal, _) = normalize_report(&raw("A-1", "00123.45", "", ""));
        assert_eq!(decimal.lectura, NO_VISIBLE);
        assert!(decimal.requiere_revision);
        let (missing, _) = normalize_report(&raw("A-1", "00123", "", ""));
        assert_eq!(missing.estado_medidor, NO_VISIBLE);
        assert!(missing.requiere_revision);
    }

    #[test]
    fn corregir_lectura_no_borra_la_averia_de_la_caja() {
        let (report, _) = normalize_report(&raw(
            "A-1",
            "00123",
            "Caja Averiada Sin Lectura",
            MEDIDOR_EN_BUEN_ESTADO,
        ));
        assert!(report.estado_conexion.contains("Caja Averiada Con Lectura"));
        assert!(report.requiere_revision);
    }
}
