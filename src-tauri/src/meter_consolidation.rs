//! Motor de consolidación multienfoque por suministro (NIS) y criticidad 1 al 5.
//!
//! En campo, un mismo suministro puede contar con múltiples fotografías tomadas
//! desde diferentes ángulos (cenital, primer plano del contador, entorno de la
//! caja). Este módulo agrupa las fotografías por su identificador de suministro
//! (NIS) a partir del nombre del archivo, complementa la evidencia entre tomas y
//! produce un único informe consolidado con su nivel de criticidad (1 al 5).
//!
//! Regla de prioridad consolidada:
//! Nivel 1 (Crítico) > Nivel 2 (Muy deficiente) > Nivel 3 (Deficiente) >
//! Nivel 4 (Insuficiente) > Nivel 5 (No válida).
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::meter_normalize::{is_numeric_sequence, NO_VISIBLE};

/// Escala formal de criticidad del 1 al 5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) enum CriticalityLevel {
    /// Incidencia grave, evidente y verificable (inundación, rotura, fuga, medidor faltante).
    Nivel1Critico = 1,
    /// Medidor existe pero entorno severamente deficiente (escombros abundantes, basura).
    Nivel2MuyDeficiente = 2,
    /// Conexión operativa con problemas menores o moderados de mantenimiento (barro, polvo, suciedad).
    Nivel3Deficiente = 3,
    /// Fotografía no concluyente (borrosa, desenfocada, empañada, mal ángulo).
    Nivel4NoConcluyente = 4,
    /// Fotografía que no corresponde a la conexión (calle, fachadas, personas, vehículos).
    Nivel5NoValida = 5,
}

impl CriticalityLevel {
    pub(crate) fn as_u8(&self) -> u8 {
        *self as u8
    }

    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Nivel1Critico => "Crítico",
            Self::Nivel2MuyDeficiente => "Muy deficiente",
            Self::Nivel3Deficiente => "Deficiente / Observación",
            Self::Nivel4NoConcluyente => "Imagen insuficiente / No concluyente",
            Self::Nivel5NoValida => "Foto no válida / No corresponde",
        }
    }

    pub(crate) fn default_action(&self) -> &'static str {
        match self {
            Self::Nivel1Critico => "Atención inmediata",
            Self::Nivel2MuyDeficiente => "Limpieza y mantenimiento prioritario",
            Self::Nivel3Deficiente => "Limpieza y mantenimiento",
            Self::Nivel4NoConcluyente => "Nueva fotografía",
            Self::Nivel5NoValida => "Nueva inspección",
        }
    }
}

/// Categoría de una fotografía individual en relación con la conexión.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PhotoCategory {
    Valida,
    NoConcluyente,
    NoRelacionada,
}

/// Detalle resumido de una fotografía asociada a un suministro.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupplyPhotoItem {
    pub(crate) file_name: String,
    pub(crate) file_path: String,
    pub(crate) photo_index: Option<u32>,
    pub(crate) category: PhotoCategory,
    pub(crate) criticality: u8,
    pub(crate) numero_medidor: String,
    pub(crate) lectura: String,
    pub(crate) estado_conexion: String,
    pub(crate) estado_medidor: String,
    pub(crate) observacion: String,
    pub(crate) status: String,
}

/// Informe único y consolidado por cada suministro (NIS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupplyConsolidatedReport {
    pub(crate) suministro: String,
    pub(crate) total_fotos: usize,
    pub(crate) fotos_validas: usize,
    pub(crate) fotos_no_concluyentes: usize,
    pub(crate) fotos_no_relacionadas: usize,
    pub(crate) medidor_encontrado: String,
    pub(crate) lectura_visible: String,
    pub(crate) numero_medidor: String,
    pub(crate) lectura: String,
    pub(crate) estado_medidor: String,
    pub(crate) estado_conexion: String,
    pub(crate) incidencias_detectadas: Vec<String>,
    pub(crate) nivel_criticidad: u8,
    pub(crate) descripcion_nivel: String,
    pub(crate) conclusion_consolidada: String,
    pub(crate) accion_sugerida: String,
    pub(crate) fotos: Vec<SupplyPhotoItem>,
}

/// Extrae el identificador del suministro (NIS) y el número de fotografía.
///
/// Soporta las estructuras comunes de SEDAPAL:
/// - `1001TE202502007-4_4261265_1.jpg` -> NIS `4261265`, Foto `1`
/// - `1001TE202502007-16_2652682_3.jpg` -> NIS `2652682`, Foto `3`
/// - `2653638_1.jpg` -> NIS `2653638`, Foto `1`
/// - `3506815_1__p2628.jpg` -> NIS `3506815`, Foto `1`
/// - `3090811.jpg` -> NIS `3090811`, Foto `None`
pub(crate) fn extract_supply_nis(file_name: &str) -> (String, Option<u32>) {
    // 1. Quitar extensión.
    let base = match file_name.rfind('.') {
        Some(dot_pos) if dot_pos > 0 => {
            file_name.get(..dot_pos).unwrap_or(file_name)
        }
        _ => file_name,
    };

    // 2. Limpiar sufijos secundarios como `__p1234`
    let clean_base = if let Some(p_pos) = base.find("__p") {
        base.get(..p_pos).unwrap_or(base)
    } else {
        base
    };

    // 3. Dividir por guiones bajos
    let parts: Vec<&str> = clean_base.split('_').filter(|s| !s.is_empty()).collect();

    // Caso A: Estructura SEDAPAL con prefijo de orden `1001TE...-4_4261265_1`
    if parts.len() >= 3 {
        // El último elemento suele ser el índice de foto si es numérico
        let last = parts.get(parts.len().saturating_sub(1)).copied().unwrap_or("");
        let photo_idx = last.parse::<u32>().ok();

        // Buscar el NIS: secuencia de 6 a 8 dígitos en las partes
        // Priorizar la parte previa al índice de foto
        let prev_index = parts.len().saturating_sub(2);
        if let Some(candidate) = parts.get(prev_index) {
            if is_nis_like(candidate) {
                return (candidate.to_string(), photo_idx);
            }
        }

        // Si no está ahí, buscar en cualquiera de las partes de atrás hacia adelante
        for &part in parts.iter().rev() {
            if is_nis_like(part) {
                return (part.to_string(), photo_idx);
            }
        }
    }

    // Caso B: Estructura simple `2653638_1`
    if parts.len() == 2 {
        let first = parts.first().copied().unwrap_or("");
        let second = parts.get(1).copied().unwrap_or("");
        let photo_idx = second.parse::<u32>().ok();
        if is_nis_like(first) {
            return (first.to_string(), photo_idx);
        }
        if is_nis_like(second) {
            return (second.to_string(), None);
        }
        return (first.to_string(), photo_idx);
    }

    // Caso C: Archivo sin separadores o nombre directo `4069658`
    if parts.len() == 1 {
        let only = parts.first().copied().unwrap_or("");
        // Si contiene dígitos de 6 a 8 cifras dentro del texto
        if let Some(nis) = find_nis_in_string(only) {
            return (nis, None);
        }
        return (only.to_string(), None);
    }

    // Fallback: buscar cualquier secuencia de 6 a 8 dígitos contiguos
    if let Some(nis) = find_nis_in_string(clean_base) {
        let last = parts.last().copied().unwrap_or("");
        let photo_idx = last.parse::<u32>().ok();
        return (nis, photo_idx);
    }

    (clean_base.to_string(), None)
}

/// Un NIS de SEDAPAL típicamente consta de 7 dígitos (ocasionalmente 6 u 8).
fn is_nis_like(candidate: &str) -> bool {
    let trimmed = candidate.trim();
    let len = trimmed.len();
    (6..=8).contains(&len) && trimmed.chars().all(|c| c.is_ascii_digit())
}

/// Busca una subsecuencia de 6 a 8 dígitos delimitada en una cadena.
fn find_nis_in_string(text: &str) -> Option<String> {
    let mut current_digits = String::new();
    for c in text.chars() {
        if c.is_ascii_digit() {
            current_digits.push(c);
        } else {
            if is_nis_like(&current_digits) {
                return Some(current_digits);
            }
            current_digits.clear();
        }
    }
    if is_nis_like(&current_digits) {
        Some(current_digits)
    } else {
        None
    }
}

/// Clasifica una fotografía individual en su categoría y nivel de criticidad.
pub(crate) fn evaluate_single_photo(
    numero_medidor: &str,
    lectura: &str,
    estado_conexion: &str,
    estado_medidor: &str,
    observacion: &str,
    status: &str,
) -> (PhotoCategory, CriticalityLevel, Vec<String>) {
    if status == "error" {
        return (
            PhotoCategory::NoConcluyente,
            CriticalityLevel::Nivel4NoConcluyente,
            vec!["Error de análisis en fotografía".to_string()],
        );
    }

    let all_text = format!("{estado_conexion} {estado_medidor} {observacion}").to_lowercase();
    let mut incidencias = Vec::new();

    // 1. Detección de Nivel 5 (Foto no válida / No corresponde a la conexión)
    let is_non_connection = all_text.contains("no corresponde")
        || all_text.contains("fachada")
        || all_text.contains("calle")
        || all_text.contains("pista")
        || all_text.contains("vehiculo")
        || all_text.contains("persona")
        || all_text.contains("no se observa conexion")
        || all_text.contains("no se aprecia conexion");
    if is_non_connection
        && !all_text.contains("caja")
        && !all_text.contains("medidor")
        && numero_medidor == NO_VISIBLE
        && lectura == NO_VISIBLE
    {
        return (
            PhotoCategory::NoRelacionada,
            CriticalityLevel::Nivel5NoValida,
            vec!["Fotografía no corresponde a la conexión de agua".to_string()],
        );
    }

    // 2. Detección de Nivel 4 (Imagen insuficiente / No concluyente)
    let is_inconclusive = all_text.contains("borrosa")
        || all_text.contains("desenfocada")
        || all_text.contains("empañada")
        || all_text.contains("mala iluminacion")
        || all_text.contains("oscura")
        || all_text.contains("fuera de cuadro")
        || all_text.contains("no permite determinar")
        || (numero_medidor == NO_VISIBLE
            && lectura == NO_VISIBLE
            && all_text.contains("no se aprecia"));
    if is_inconclusive
        && !all_text.contains("inundad")
        && !all_text.contains("agua acumulada")
        && !all_text.contains("roto")
        && !all_text.contains("escombros")
    {
        return (
            PhotoCategory::NoConcluyente,
            CriticalityLevel::Nivel4NoConcluyente,
            vec!["Imagen borrosa o insuficiente para evaluación concluyente".to_string()],
        );
    }

    // 3. Detección de Nivel 1 (Crítico)
    // Agua acumulada / inundación: PRIORIDAD ABSOLUTA sobre barro/tierra.
    // "sin agua acumulada" se excluye explícitamente: es la etiqueta de
    // humedad intermedia (Nivel 2), y sin este guard "agua acumulada" hace
    // match igual dentro de la frase negada.
    //
    // Un reflejo tipo espejo en el visor se describe con las mismas palabras
    // que una inundación real ("agua acumulada", "inundada") sin que haya
    // agua de verdad: es brillo, no nivel de agua. Solo cuenta como
    // inundación si, además del reflejo, hay evidencia más fuerte
    // (encharcada, sumergido, anegado, nivel de agua visible).
    let solo_reflejo_sin_evidencia_fuerte = all_text.contains("reflejo")
        && !all_text.contains("encharcad")
        && !all_text.contains("sumergid")
        && !all_text.contains("anegad")
        && !all_text.contains("nivel de agua");
    let is_inundada = !all_text.contains("sin agua acumulada")
        && !solo_reflejo_sin_evidencia_fuerte
        && (all_text.contains("inundad")
            || all_text.contains("agua acumulada")
            || all_text.contains("acumulacion de agua")
            || all_text.contains("anegad")
            || all_text.contains("sumergid"));
    if is_inundada {
        incidencias.push("Caja de conexión inundada con agua acumulada".to_string());
    }

    // Rotura o medidor severamente averiado
    let is_roto = all_text.contains("roto")
        || all_text.contains("destruido")
        || all_text.contains("visor roto")
        || all_text.contains("luna rota")
        || all_text.contains("medidor manipulado-averiado-roto");
    if is_roto {
        incidencias.push("Medidor o visor con rotura o daño severo".to_string());
    }

    // Fuga evidente
    let is_fuga = all_text.contains("fuga evidente") || all_text.contains("conexion con fuga");
    if is_fuga {
        incidencias.push("Fuga evidente en la conexión".to_string());
    }

    // Medidor no encontrado
    let is_no_encontrado = all_text.contains("medidor no encontrado")
        || all_text.contains("sin medidor");

    // "No se ve" no es lo mismo que "confirmado que no existe": el modelo
    // escribe "no encontrado" tanto cuando de verdad falta el medidor como
    // cuando simplemente no logró verlo (tapa cerrada, mal ángulo, toma
    // insuficiente, foto mal tomada...), y enumerar cada forma de decir "no
    // se ve" es frágil. En cambio, la ausencia física exige evidencia
    // positiva de que el medidor no está: un tubo o conexión vacía en su
    // lugar, o una confirmación explícita de que no está instalado. Sin esa
    // evidencia, la falta de observación por sí sola no basta para Nivel 1.
    let confirma_ausencia_fisica = all_text.contains("tubo")
        || all_text.contains("tuberia")
        || all_text.contains("tubería")
        || all_text.contains("conexion vacia")
        || all_text.contains("conexión vacía")
        || all_text.contains("conexion abierta")
        || all_text.contains("conexión abierta")
        || all_text.contains("caja vacia")
        || all_text.contains("caja vacía")
        || all_text.contains("sin instalar")
        || all_text.contains("no instalado")
        || all_text.contains("no esta instalado")
        || all_text.contains("no está instalado")
        || all_text.contains("no existe medidor")
        || all_text.contains("no cuenta con medidor");

    if is_no_encontrado && !confirma_ausencia_fisica && !is_inundada && !is_roto && !is_fuga {
        incidencias.push(
            "Medidor no visible en la fotografía; no hay evidencia física que confirme su ausencia (podría deberse a ángulo, encuadre o toma insuficiente)"
                .to_string(),
        );
        return (
            PhotoCategory::NoConcluyente,
            CriticalityLevel::Nivel4NoConcluyente,
            incidencias,
        );
    }

    if is_no_encontrado && !is_inundada {
        incidencias.push("Medidor no encontrado en la conexión".to_string());
    }

    if is_inundada || is_roto || is_fuga || is_no_encontrado {
        return (
            PhotoCategory::Valida,
            CriticalityLevel::Nivel1Critico,
            incidencias,
        );
    }

    // 4. Detección de Nivel 2 (Muy deficiente)
    let is_escombros = all_text.contains("escombros")
        || all_text.contains("gran cantidad de basura")
        || all_text.contains("abundante basura")
        || all_text.contains("desperdicios")
        || all_text.contains("trapos")
        || all_text.contains("suciedad extrema");
    if is_escombros {
        incidencias.push("Caja con acumulación severa de escombros, basura o desperdicios".to_string());
        return (
            PhotoCategory::Valida,
            CriticalityLevel::Nivel2MuyDeficiente,
            incidencias,
        );
    }

    // 4b. Placa o protector del medidor en estado oxidado: es un elemento de
    // protección degradado (no suciedad del entorno), así que pesa más que un
    // Nivel 3 genérico sin llegar a ser un daño crítico del medidor mismo.
    let is_placa_oxidada = (all_text.contains("placa protectora")
        || all_text.contains("placa de proteccion")
        || all_text.contains("protector del medidor")
        || all_text.contains("protector de medidor"))
        && (all_text.contains("oxidad") || all_text.contains("oxido"));
    if is_placa_oxidada {
        incidencias.push("Placa o protector del medidor en estado oxidado".to_string());
        return (
            PhotoCategory::Valida,
            CriticalityLevel::Nivel2MuyDeficiente,
            incidencias,
        );
    }

    // 4c. Conexión mojada/húmeda pero sin agua acumulada o encharcada visible:
    // es un paso intermedio entre "humedad leve" (Nivel 3) e "inundación"
    // (Nivel 1). Solo aplica si el propio Nivel 1 no se disparó ya por
    // "inundad"/"agua acumulada" arriba.
    let is_semi_mojado = !is_inundada
        && (all_text.contains("mojada sin agua acumulada")
            || all_text.contains("mojado sin agua acumulada")
            || all_text.contains("semi mojad")
            || all_text.contains("semi humed")
            || all_text.contains("conexion mojada sin agua acumulada"));
    if is_semi_mojado {
        incidencias.push("Conexión mojada o húmeda, sin agua acumulada ni encharcada visible".to_string());
        return (
            PhotoCategory::Valida,
            CriticalityLevel::Nivel2MuyDeficiente,
            incidencias,
        );
    }

    // 5. Detección de Nivel 3 (Deficiente / Observación)
    let is_deficiente = all_text.contains("barro")
        || all_text.contains("tierra")
        || all_text.contains("polvo")
        || all_text.contains("suciedad")
        || all_text.contains("oxidacion")
        || all_text.contains("rajadura")
        || all_text.contains("deterioro menor")
        || all_text.contains("caja averiada con lectura");
    if is_deficiente {
        incidencias.push("Acumulación moderada de tierra, barro o deterioro menor de caja".to_string());
    }

    (
        PhotoCategory::Valida,
        CriticalityLevel::Nivel3Deficiente,
        incidencias,
    )
}

/// Consolida todas las fotografías pertenecientes a un mismo suministro.
pub(crate) fn consolidate_supply(
    suministro: &str,
    fotos: Vec<SupplyPhotoItem>,
) -> SupplyConsolidatedReport {
    let total_fotos = fotos.len();
    let mut fotos_validas = 0usize;
    let mut fotos_no_concluyentes = 0usize;
    let mut fotos_no_relacionadas = 0usize;

    let mut best_numero_medidor = NO_VISIBLE.to_string();
    let mut best_lectura = NO_VISIBLE.to_string();
    let mut all_incidencias: Vec<String> = Vec::new();

    let mut max_crit_valida: Option<CriticalityLevel> = None;
    let mut has_meter_seen = false;
    let mut has_meter_missing = false;
    let mut has_inundacion = false;
    let mut has_meter_severe_damage = false;
    let mut has_connection_severe_damage = false;
    let mut best_estado_medidor = String::new();
    let mut best_estado_medidor_has_evidence = false;
    let mut best_estado_conexion = String::new();
    let mut best_estado_conexion_has_evidence = false;

    for foto in &fotos {
        match foto.category {
            PhotoCategory::Valida => {
                fotos_validas += 1;
                let crit = match foto.criticality {
                    1 => CriticalityLevel::Nivel1Critico,
                    2 => CriticalityLevel::Nivel2MuyDeficiente,
                    _ => CriticalityLevel::Nivel3Deficiente,
                };
                max_crit_valida = Some(match max_crit_valida {
                    Some(prev) => prev.min(crit), // Nivel 1 < Nivel 2 < Nivel 3 en orden enum
                    None => crit,
                });

                // Rescatar número de medidor si es visible
                if foto.numero_medidor != NO_VISIBLE && !foto.numero_medidor.trim().is_empty() {
                    best_numero_medidor = foto.numero_medidor.clone();
                }

                // Rescatar lectura numérica si es legible
                if is_numeric_sequence(&foto.lectura) {
                    best_lectura = foto.lectura.clone();
                }

                let lower_con = foto.estado_conexion.to_lowercase();
                let lower_med = foto.estado_medidor.to_lowercase();
                let lower_obs = foto.observacion.to_lowercase();

                // Ojo: "agua" a secas también hace match en "Sin Agua
                // Acumulada" (la etiqueta de humedad sin inundación), así que
                // se exige la frase completa en vez del sustantivo suelto.
                if lower_con.contains("inundad")
                    || lower_con.contains("agua acumulada")
                    || lower_con.contains("encharcad")
                    || lower_con.contains("anegad")
                {
                    has_inundacion = true;
                }

                // Distingue si el daño severo (Nivel 1) reportado en alguna toma es
                // del medidor en sí o de la caja/conexión, revisando cada campo por
                // separado en vez del texto combinado: así la conclusión no le echa
                // la culpa al medidor cuando el que está roto es solo la caja (o
                // viceversa).
                if lower_med.contains("roto")
                    || lower_med.contains("destruid")
                    || lower_med.contains("manipulad")
                    || lower_med.contains("averiad")
                    || lower_med.contains("luna rota")
                {
                    has_meter_severe_damage = true;
                }
                if lower_con.contains("rotur")
                    || lower_con.contains("roto")
                    || lower_con.contains("destruid")
                    || lower_con.contains("rajad")
                    || lower_con.contains("quebrad")
                    || lower_con.contains("fuga")
                    || lower_obs.contains("fuga evidente")
                    || lower_obs.contains("conexion con fuga")
                {
                    has_connection_severe_damage = true;
                }

                // Un número de medidor o una lectura numérica visibles son evidencia
                // directa de que el medidor existe físicamente, aunque otra toma del
                // mismo suministro no lo haya captado (ángulo distinto, tubo tapando
                // la vista, etc.). Esa evidencia tiene prioridad sobre un "no
                // encontrado" reportado en otra toma.
                let meter_present_evidence =
                    foto.numero_medidor != NO_VISIBLE || is_numeric_sequence(&foto.lectura);
                if meter_present_evidence {
                    has_meter_seen = true;
                } else if lower_med.contains("no encontrado") {
                    has_meter_missing = true;
                }

                if best_estado_medidor.is_empty()
                    || best_estado_medidor == NO_VISIBLE
                    || (meter_present_evidence && !best_estado_medidor_has_evidence)
                {
                    best_estado_medidor = foto.estado_medidor.clone();
                    best_estado_medidor_has_evidence = meter_present_evidence;
                }
                if best_estado_conexion.is_empty()
                    || best_estado_conexion == NO_VISIBLE
                    || (meter_present_evidence && !best_estado_conexion_has_evidence)
                {
                    best_estado_conexion = foto.estado_conexion.clone();
                    best_estado_conexion_has_evidence = meter_present_evidence;
                }
            }
            PhotoCategory::NoConcluyente => {
                fotos_no_concluyentes += 1;
            }
            PhotoCategory::NoRelacionada => {
                fotos_no_relacionadas += 1;
            }
        }
    }

    // Nivel final consolidado por prioridad:
    // 1 > 2 > 3 > 4 > 5
    let (nivel, descripcion, accion, conclusion) = if fotos_validas > 0 {
        let crit = max_crit_valida.unwrap_or(CriticalityLevel::Nivel3Deficiente);
        let desc = crit.label().to_string();
        let act = crit.default_action().to_string();

        // "No encontrado" solo se confirma si ninguna otra toma del mismo
        // suministro mostró evidencia del medidor (número o lectura visibles).
        let meter_confirmed_missing = has_meter_missing && !has_meter_seen;

        let concl = match crit {
            CriticalityLevel::Nivel1Critico => {
                if has_inundacion {
                    all_incidencias.push("Caja de conexión inundada o con gran acumulación de agua.".to_string());
                    "Se identifica caja de conexión inundada con agua acumulada que compromete la instalación y la visibilidad del medidor.".to_string()
                } else if meter_confirmed_missing {
                    all_incidencias.push("Medidor no encontrado cuando debería existir.".to_string());
                    "Se confirma medidor no encontrado en la conexión de agua potable.".to_string()
                } else if has_connection_severe_damage && !has_meter_severe_damage {
                    all_incidencias.push("Conexión o caja con rotura, fuga o daño crítico evidente.".to_string());
                    "Existe evidencia visual de daño severo en la conexión de agua potable; el medidor no presenta daño en las tomas analizadas.".to_string()
                } else if has_meter_severe_damage && !has_connection_severe_damage {
                    all_incidencias.push("Medidor o visor con rotura o daño crítico evidente.".to_string());
                    "Existe evidencia visual de daño severo o rotura en el medidor.".to_string()
                } else {
                    all_incidencias.push("Medidor, visor o conexión con daño crítico evidente.".to_string());
                    "Existe evidencia visual de daño severo o rotura en el medidor/conexión en las fotografías analizadas.".to_string()
                }
            }
            CriticalityLevel::Nivel2MuyDeficiente => {
                all_incidencias.push("Caja con acumulación abundante de escombros y desperdicios.".to_string());
                "El medidor existe, pero se observa acumulación severa de escombros y basura dentro de la caja que dificulta la inspección técnica.".to_string()
            }
            CriticalityLevel::Nivel3Deficiente => {
                all_incidencias.push("Suciedad, barro o desgaste menor de mantenimiento en caja o medidor.".to_string());
                "La conexión se encuentra operativa y el medidor es identificable, requiriendo limpieza y mantenimiento preventivo.".to_string()
            }
            _ => "Inspección completada con evidencia técnica.".to_string(),
        };

        (crit.as_u8(), desc, act, concl)
    } else if fotos_no_concluyentes > 0 {
        (
            CriticalityLevel::Nivel4NoConcluyente.as_u8(),
            CriticalityLevel::Nivel4NoConcluyente.label().to_string(),
            CriticalityLevel::Nivel4NoConcluyente.default_action().to_string(),
            "No se dispone de suficiente evidencia visual: las tomas del suministro están desenfocadas, empañadas o no permiten determinar el estado de la conexión.".to_string(),
        )
    } else {
        (
            CriticalityLevel::Nivel5NoValida.as_u8(),
            CriticalityLevel::Nivel5NoValida.label().to_string(),
            CriticalityLevel::Nivel5NoValida.default_action().to_string(),
            "Las fotografías analizadas no muestran la caja, conexión ni medidor de agua potable.".to_string(),
        )
    };

    let medidor_encontrado = if has_meter_seen || best_numero_medidor != NO_VISIBLE || is_numeric_sequence(&best_lectura) {
        "Sí".to_string()
    } else if has_meter_missing {
        "No".to_string()
    } else if has_inundacion {
        "No determinable (sumergido)".to_string()
    } else if fotos_validas > 0 {
        "Sí".to_string()
    } else {
        "No determinable".to_string()
    };

    let lectura_visible = if is_numeric_sequence(&best_lectura) {
        "Sí".to_string()
    } else if best_lectura == "Dudoso" || best_lectura == "Parcial" {
        "Parcial".to_string()
    } else {
        "No".to_string()
    };

    SupplyConsolidatedReport {
        suministro: suministro.to_string(),
        total_fotos,
        fotos_validas,
        fotos_no_concluyentes,
        fotos_no_relacionadas,
        medidor_encontrado,
        lectura_visible,
        numero_medidor: best_numero_medidor,
        lectura: best_lectura,
        estado_medidor: if best_estado_medidor.is_empty() { NO_VISIBLE.to_string() } else { best_estado_medidor },
        estado_conexion: if best_estado_conexion.is_empty() { NO_VISIBLE.to_string() } else { best_estado_conexion },
        incidencias_detectadas: all_incidencias,
        nivel_criticidad: nivel,
        descripcion_nivel: descripcion,
        conclusion_consolidada: conclusion,
        accion_sugerida: accion,
        fotos,
    }
}

/// Agrupa un listado de fotos ya analizadas por su NIS y produce los reportes consolidados.
pub(crate) fn group_and_consolidate(
    items: Vec<SupplyPhotoItem>,
) -> Vec<SupplyConsolidatedReport> {
    let mut groups: BTreeMap<String, Vec<SupplyPhotoItem>> = BTreeMap::new();
    for item in items {
        let (nis, _) = extract_supply_nis(&item.file_name);
        groups.entry(nis).or_default().push(item);
    }

    groups
        .into_iter()
        .map(|(nis, photos)| consolidate_supply(&nis, photos))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_estructura_con_orden_y_subindice() {
        let (nis, idx) = extract_supply_nis("1001TE202502007-4_4261265_1.jpg");
        assert_eq!(nis, "4261265");
        assert_eq!(idx, Some(1));

        let (nis, idx) = extract_supply_nis("1001TE202502007-16_2652682_3.jpg");
        assert_eq!(nis, "2652682");
        assert_eq!(idx, Some(3));
    }

    #[test]
    fn parsea_estructura_simple() {
        let (nis, idx) = extract_supply_nis("2653638_1.jpg");
        assert_eq!(nis, "2653638");
        assert_eq!(idx, Some(1));

        let (nis, idx) = extract_supply_nis("3090811.jpg");
        assert_eq!(nis, "3090811");
        assert_eq!(idx, None);
    }

    #[test]
    fn consolida_prioridad_critica_por_inundacion() {
        let f1 = SupplyPhotoItem {
            file_name: "2653638_1.jpg".to_string(),
            file_path: "/path/2653638_1.jpg".to_string(),
            photo_index: Some(1),
            category: PhotoCategory::Valida,
            criticality: 1,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: NO_VISIBLE.to_string(),
            estado_conexion: "Caja de conexión con agua acumulada e inundación".to_string(),
            estado_medidor: "No visible por sumersión".to_string(),
            observacion: "Agua acumulada".to_string(),
            status: "done".to_string(),
        };
        let f2 = SupplyPhotoItem {
            file_name: "2653638_2.jpg".to_string(),
            file_path: "/path/2653638_2.jpg".to_string(),
            photo_index: Some(2),
            category: PhotoCategory::Valida,
            criticality: 3,
            numero_medidor: "DB12345".to_string(),
            lectura: "00120".to_string(),
            estado_conexion: "Sin incidencia de conexión visible.".to_string(),
            estado_medidor: "Medidor visible con suciedad superficial.".to_string(),
            observacion: "Polvo".to_string(),
            status: "done".to_string(),
        };

        let report = consolidate_supply("2653638", vec![f1, f2]);
        assert_eq!(report.nivel_criticidad, 1);
        assert_eq!(report.descripcion_nivel, "Crítico");
        assert_eq!(report.accion_sugerida, "Atención inmediata");
        assert_eq!(report.total_fotos, 2);
        assert_eq!(report.fotos_validas, 2);
        assert_eq!(report.numero_medidor, "DB12345");
        assert_eq!(report.lectura, "00120");
    }

    #[test]
    fn foto_borrosa_individual_no_degrada_si_existe_foto_valida() {
        let f1 = SupplyPhotoItem {
            file_name: "4069658_1.jpg".to_string(),
            file_path: "/path/4069658_1.jpg".to_string(),
            photo_index: Some(1),
            category: PhotoCategory::NoConcluyente,
            criticality: 4,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: NO_VISIBLE.to_string(),
            estado_conexion: "Imagen borrosa".to_string(),
            estado_medidor: "No visible".to_string(),
            observacion: "Desenfocada".to_string(),
            status: "done".to_string(),
        };
        let f2 = SupplyPhotoItem {
            file_name: "4069658_2.jpg".to_string(),
            file_path: "/path/4069658_2.jpg".to_string(),
            photo_index: Some(2),
            category: PhotoCategory::Valida,
            criticality: 2,
            numero_medidor: "ZENNER-99".to_string(),
            lectura: "01642".to_string(),
            estado_conexion: "Caja llena de escombros de concreto y basura".to_string(),
            estado_medidor: "Medidor visible".to_string(),
            observacion: "Escombros abundantes".to_string(),
            status: "done".to_string(),
        };

        let report = consolidate_supply("4069658", vec![f1, f2]);
        assert_eq!(report.nivel_criticidad, 2);
        assert_eq!(report.descripcion_nivel, "Muy deficiente");
        assert_eq!(report.accion_sugerida, "Limpieza y mantenimiento prioritario");
        assert_eq!(report.fotos_validas, 1);
        assert_eq!(report.fotos_no_concluyentes, 1);
    }

    #[test]
    fn atribuye_dano_severo_a_la_conexion_no_al_medidor_cuando_el_medidor_esta_bien() {
        let f1 = SupplyPhotoItem {
            file_name: "2614674_1.jpg".to_string(),
            file_path: "/path/2614674_1.jpg".to_string(),
            photo_index: Some(1),
            category: PhotoCategory::Valida,
            criticality: 1,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: "17070".to_string(),
            estado_conexion: "Caja de conexión rota y con fuga evidente".to_string(),
            estado_medidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.".to_string(),
            observacion: "Se observa fuga de agua en la conexión.".to_string(),
            status: "done".to_string(),
        };

        let report = consolidate_supply("2614674", vec![f1]);
        assert_eq!(report.nivel_criticidad, 1);
        assert!(
            report.conclusion_consolidada.contains("daño severo en la conexión"),
            "conclusión inesperada: {}",
            report.conclusion_consolidada
        );
        assert!(!report.conclusion_consolidada.contains("el medidor/conexión"));
        assert_eq!(
            report.estado_medidor,
            "Medidor en buen estado; lectura legible y sin incidencias visibles."
        );
    }

    #[test]
    fn placa_protectora_oxidada_es_nivel_2() {
        let (categoria, nivel, incidencias) = evaluate_single_photo(
            NO_VISIBLE,
            "04321",
            "Sin incidencia de conexión visible.",
            "Medidor en buen estado; lectura legible y sin incidencias visibles.",
            "Se visualiza la placa protectora del medidor en estado oxidado.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::Valida);
        assert_eq!(nivel, CriticalityLevel::Nivel2MuyDeficiente);
        assert!(incidencias.iter().any(|i| i.contains("oxidado")));
    }

    #[test]
    fn conexion_mojada_sin_agua_acumulada_es_nivel_2_no_nivel_1() {
        let (categoria, nivel, incidencias) = evaluate_single_photo(
            NO_VISIBLE,
            "03765",
            "Conexión Mojada Sin Agua Acumulada",
            "Medidor en buen estado; lectura legible y sin incidencias visibles.",
            "Medidor sobre superficie húmeda, sin agua estancada visible.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::Valida);
        assert_eq!(nivel, CriticalityLevel::Nivel2MuyDeficiente);
        assert!(incidencias.iter().any(|i| i.contains("húmeda")));
    }

    #[test]
    fn conexion_mojada_sin_agua_acumulada_no_dispara_inundacion_en_consolidado() {
        let f1 = SupplyPhotoItem {
            file_name: "9999999_1.jpg".to_string(),
            file_path: "/path/9999999_1.jpg".to_string(),
            photo_index: Some(1),
            category: PhotoCategory::Valida,
            criticality: 2,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: "03765".to_string(),
            estado_conexion: "Conexión Mojada Sin Agua Acumulada".to_string(),
            estado_medidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.".to_string(),
            observacion: "Medidor sobre superficie húmeda, sin agua estancada visible.".to_string(),
            status: "done".to_string(),
        };

        let report = consolidate_supply("9999999", vec![f1]);
        assert_eq!(report.nivel_criticidad, 2);
        assert!(!report.conclusion_consolidada.contains("inundada"));
    }

    #[test]
    fn no_confirma_medidor_no_encontrado_si_otra_toma_lo_muestra_con_lectura() {
        // Toma 1: solo se ve un tubo de PVC, el medidor no aparece en esta toma.
        let f1 = SupplyPhotoItem {
            file_name: "2030187_1.jpg".to_string(),
            file_path: "/path/2030187_1.jpg".to_string(),
            photo_index: Some(1),
            category: PhotoCategory::Valida,
            criticality: 1,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: NO_VISIBLE.to_string(),
            estado_conexion: "Caja Averiada Sin Lectura".to_string(),
            estado_medidor: "Medidor No Encontrado".to_string(),
            observacion: "Se observa un tubo de PVC en el lugar del medidor.".to_string(),
            status: "done".to_string(),
        };
        // Toma 2: el medidor sí aparece, con lectura visible, aunque dañado/manipulado.
        let f2 = SupplyPhotoItem {
            file_name: "2030187_2.jpg".to_string(),
            file_path: "/path/2030187_2.jpg".to_string(),
            photo_index: Some(2),
            category: PhotoCategory::Valida,
            criticality: 1,
            numero_medidor: NO_VISIBLE.to_string(),
            lectura: "36954".to_string(),
            estado_conexion: "Caja Averiada Con Lectura".to_string(),
            estado_medidor: "Medidor Manipulado-Averiado-Roto".to_string(),
            observacion: "Medidor fuera de su posición original.".to_string(),
            status: "done".to_string(),
        };

        let report = consolidate_supply("2030187", vec![f1, f2]);
        assert_eq!(report.nivel_criticidad, 1);
        assert_eq!(report.medidor_encontrado, "Sí");
        assert_eq!(report.lectura, "36954");
        assert!(
            !report.conclusion_consolidada.contains("no encontrado"),
            "la conclusión no debe contradecir la evidencia de la toma 2: {}",
            report.conclusion_consolidada
        );
        assert!(report
            .incidencias_detectadas
            .iter()
            .all(|i| !i.contains("no encontrado")));
        assert_eq!(report.estado_medidor, "Medidor Manipulado-Averiado-Roto");
    }

    #[test]
    fn medidor_no_encontrado_por_mal_angulo_no_es_critico() {
        let (categoria, nivel, incidencias) = evaluate_single_photo(
            NO_VISIBLE,
            NO_VISIBLE,
            "Sin incidencia de conexión visible.",
            "Medidor No Encontrado",
            "Se observa una tapa metálica con el código NIS escrito en ella; no se visualiza el medidor.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::NoConcluyente);
        assert_eq!(nivel, CriticalityLevel::Nivel4NoConcluyente);
        assert!(incidencias.iter().any(|i| i.contains("no hay evidencia física")));
    }

    #[test]
    fn medidor_no_encontrado_por_mal_angulo_explicito_no_es_critico() {
        let (categoria, nivel, _) = evaluate_single_photo(
            NO_VISIBLE,
            NO_VISIBLE,
            "Sin incidencia de conexión visible.",
            "Medidor No Encontrado",
            "El ángulo de la toma no permite confirmar si el medidor está instalado.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::NoConcluyente);
        assert_eq!(nivel, CriticalityLevel::Nivel4NoConcluyente);
    }

    #[test]
    fn medidor_no_encontrado_sin_ver_el_visor_no_es_critico() {
        // Redacción real observada en producción: el modelo no menciona
        // "ángulo" ni "tapa cerrada" explícitamente, solo dice que no se
        // observa el medidor. Sigue sin ser evidencia de ausencia física.
        let (categoria, nivel, _) = evaluate_single_photo(
            NO_VISIBLE,
            NO_VISIBLE,
            "Sin incidencia de conexión visible.",
            "Medidor No Encontrado",
            "La fotografía muestra una tapa metálica con la anotación 'NIS-2774016' escrita a mano; no se observa el medidor ni el visor.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::NoConcluyente);
        assert_eq!(nivel, CriticalityLevel::Nivel4NoConcluyente);
    }

    #[test]
    fn medidor_no_encontrado_con_evidencia_real_sigue_siendo_critico() {
        // Un tubo de PVC en el lugar del medidor es evidencia física de
        // ausencia, no un problema de ángulo o toma: debe seguir siendo
        // Nivel 1.
        let (categoria, nivel, incidencias) = evaluate_single_photo(
            NO_VISIBLE,
            NO_VISIBLE,
            "Caja Averiada Sin Lectura",
            "Medidor No Encontrado",
            "Se observa un tubo de PVC en el lugar del medidor.",
            "done",
        );
        assert_eq!(categoria, PhotoCategory::Valida);
        assert_eq!(nivel, CriticalityLevel::Nivel1Critico);
        assert!(incidencias.iter().any(|i| i.contains("no encontrado")));
    }

    #[test]
    fn reflejo_tipo_espejo_no_se_confunde_con_inundacion() {
        let (categoria, nivel, incidencias) = evaluate_single_photo(
            "KB20001732",
            NO_VISIBLE,
            "Caja de Conexión Inundada",
            "Medidor Con Lectura Imposible",
            "El visor del medidor presenta un reflejo nítido tipo espejo que impide la lectura y se observa agua acumulada.",
            "done",
        );
        assert_ne!(nivel, CriticalityLevel::Nivel1Critico);
        assert_eq!(categoria, PhotoCategory::Valida);
        assert!(!incidencias.iter().any(|i| i.contains("inundada")));
    }

    #[test]
    fn reflejo_no_suprime_inundacion_con_evidencia_fuerte() {
        // Si además del reflejo hay evidencia fuerte (encharcada, sumergido,
        // etc.), sigue siendo una inundación real.
        let (_, nivel, _) = evaluate_single_photo(
            NO_VISIBLE,
            NO_VISIBLE,
            "Caja de conexión encharcada con agua acumulada",
            "Medidor Con Lectura Imposible",
            "El visor presenta un reflejo tipo espejo y la caja está sumergida en agua.",
            "done",
        );
        assert_eq!(nivel, CriticalityLevel::Nivel1Critico);
    }
}
