import type { CriticalityLevel, MeterResult, PhotoCategory, QueueRow, SupplyConsolidatedReport, SupplyPhotoItem } from "./types"

const NO_VISIBLE = "No visible"

/**
 * Extrae el NIS de SEDAPAL (habitualmente 7 dígitos, o entre 6 y 8 dígitos)
 * y el índice de fotografía si existe.
 *
 * Ejemplos soportados:
 * - 1001TE202502007-4_4261265_1.jpg  -> NIS: "4261265", Foto: 1
 * - 1001TE202502007-16_2652682_3.jpg -> NIS: "2652682", Foto: 3
 * - 2653638_1.jpg                    -> NIS: "2653638", Foto: 1
 * - 3090811.jpg                      -> NIS: "3090811", Foto: null
 */
export function extractSupplyNis(fileName: string): { nis: string; photoIndex: number | null } {
  const dotIndex = fileName.lastIndexOf(".")
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const clean = base.replace(/__p\d+/i, "")

  const parts = clean.split("_").filter(Boolean)

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1] ?? ""
    const photoIdx = /^\d+$/.test(lastPart) ? parseInt(lastPart, 10) : null

    // Probar primero la parte antes del índice de foto
    const candidate = parts[parts.length - 2] ?? ""
    if (/^\d{6,8}$/.test(candidate)) {
      return { nis: candidate, photoIndex: photoIdx }
    }

    // Buscar en el resto de partes
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i] ?? ""
      if (/^\d{6,8}$/.test(part)) {
        return { nis: part, photoIndex: photoIdx }
      }
    }
  }

  if (parts.length === 2) {
    const first = parts[0] ?? ""
    const second = parts[1] ?? ""
    const photoIdx = /^\d+$/.test(second) ? parseInt(second, 10) : null
    if (/^\d{6,8}$/.test(first)) {
      return { nis: first, photoIndex: photoIdx }
    }
    if (/^\d{6,8}$/.test(second)) {
      return { nis: second, photoIndex: null }
    }
    return { nis: first, photoIndex: photoIdx }
  }

  // Buscar cualquier secuencia de 6 a 8 dígitos contiguos
  const match = clean.match(/\b\d{6,8}\b/)
  if (match) {
    const lastPart = parts[parts.length - 1] ?? ""
    const photoIdx = /^\d+$/.test(lastPart) && lastPart !== match[0] ? parseInt(lastPart, 10) : null
    return { nis: match[0], photoIndex: photoIdx }
  }

  return { nis: clean, photoIndex: null }
}

/**
 * Una observación sirve como conclusión solo si la IA realmente escribió
 * algo: vacía o el centinela NO_VISIBLE no aportan nada sobre este
 * suministro en particular, así que la conclusión cae al texto fijo en esos
 * casos.
 */
function usableObservacion(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed && trimmed !== NO_VISIBLE ? trimmed : null
}

export function evaluatePhoto(
  numeroMedidor: string,
  lectura: string,
  estadoConexion: string,
  estadoMedidor: string,
  observacion: string,
  status: string
): { category: PhotoCategory; criticality: CriticalityLevel; incidencias: string[] } {
  if (status === "error") {
    return {
      category: "noConcluyente",
      criticality: 4,
      incidencias: ["Error en procesamiento de fotografía"],
    }
  }

  const all = `${estadoConexion} ${estadoMedidor} ${observacion}`.toLowerCase()
  const incidencias: string[] = []

  // 1. Nivel 5: No corresponde a la conexión
  const isNonConnection =
    all.includes("no corresponde") ||
    all.includes("fachada") ||
    all.includes("calle") ||
    all.includes("pista") ||
    all.includes("vehiculo") ||
    all.includes("persona") ||
    all.includes("no se observa conexion")
  if (isNonConnection && !all.includes("caja") && !all.includes("medidor") && numeroMedidor === NO_VISIBLE && lectura === NO_VISIBLE) {
    return {
      category: "noRelacionada",
      criticality: 5,
      incidencias: ["Fotografía no corresponde a la conexión de agua"],
    }
  }

  // 2. Nivel 4: Insuficiente / No concluyente
  const isInconclusive =
    all.includes("borrosa") ||
    all.includes("desenfocada") ||
    all.includes("empañada") ||
    all.includes("mala iluminacion") ||
    all.includes("oscura") ||
    all.includes("fuera de cuadro") ||
    all.includes("no permite determinar")
  if (isInconclusive && !all.includes("inundad") && !all.includes("agua acumulada") && !all.includes("roto") && !all.includes("escombros")) {
    return {
      category: "noConcluyente",
      criticality: 4,
      incidencias: ["Imagen borrosa o insuficiente para evaluación concluyente"],
    }
  }

  // 3. Nivel 1: Crítico
  // Agua acumulada / inundación: prioridad absoluta sobre tierra/barro.
  // "sin agua acumulada" se excluye explícitamente: es la etiqueta de
  // humedad intermedia (Nivel 2), y sin este guard "agua acumulada" hace
  // match igual dentro de la frase negada.
  //
  // Un reflejo tipo espejo en el visor se describe con las mismas palabras
  // que una inundación real ("agua acumulada", "inundada") sin que haya agua
  // de verdad: es brillo, no nivel de agua. Solo cuenta como inundación si,
  // además del reflejo, hay evidencia más fuerte (encharcada, sumergido,
  // anegado, nivel de agua visible).
  const soloReflejoSinEvidenciaFuerte =
    all.includes("reflejo") &&
    !all.includes("encharcad") &&
    !all.includes("sumergid") &&
    !all.includes("anegad") &&
    !all.includes("nivel de agua")
  const isInundada =
    !all.includes("sin agua acumulada") &&
    !soloReflejoSinEvidenciaFuerte &&
    (all.includes("inundad") ||
      all.includes("agua acumulada") ||
      all.includes("acumulacion de agua") ||
      all.includes("anegad") ||
      all.includes("sumergid"))
  if (isInundada) {
    incidencias.push("Caja de conexión inundada con agua acumulada")
  }

  const isRoto =
    all.includes("roto") ||
    all.includes("destruido") ||
    all.includes("visor roto") ||
    all.includes("luna rota") ||
    all.includes("manipulado-averiado-roto")
  if (isRoto) {
    incidencias.push("Medidor o visor con rotura o daño severo")
  }

  const isFuga = all.includes("fuga evidente") || all.includes("conexion con fuga")
  if (isFuga) {
    incidencias.push("Fuga evidente en la conexión")
  }

  const isNoEncontrado = all.includes("medidor no encontrado") || all.includes("sin medidor")

  // "No se ve" no es lo mismo que "confirmado que no existe": el modelo
  // escribe "no encontrado" tanto cuando de verdad falta el medidor como
  // cuando simplemente no logró verlo (tapa cerrada, mal ángulo, toma
  // insuficiente, foto mal tomada...), y enumerar cada forma de decir "no se
  // ve" es frágil. En cambio, la ausencia física exige evidencia positiva de
  // que el medidor no está: un tubo o conexión vacía en su lugar, o una
  // confirmación explícita de que no está instalado. Sin esa evidencia, la
  // falta de observación por sí sola no basta para Nivel 1.
  const confirmaAusenciaFisica =
    all.includes("tubo") ||
    all.includes("tuberia") ||
    all.includes("tubería") ||
    all.includes("conexion vacia") ||
    all.includes("conexión vacía") ||
    all.includes("conexion abierta") ||
    all.includes("conexión abierta") ||
    all.includes("caja vacia") ||
    all.includes("caja vacía") ||
    all.includes("sin instalar") ||
    all.includes("no instalado") ||
    all.includes("no esta instalado") ||
    all.includes("no está instalado") ||
    all.includes("no existe medidor") ||
    all.includes("no cuenta con medidor")

  if (isNoEncontrado && !confirmaAusenciaFisica && !isInundada && !isRoto && !isFuga) {
    return {
      category: "noConcluyente",
      criticality: 4,
      incidencias: [
        "Medidor no visible en la fotografía; no hay evidencia física que confirme su ausencia (podría deberse a ángulo, encuadre o toma insuficiente)",
      ],
    }
  }

  if (isNoEncontrado && !isInundada) {
    incidencias.push("Medidor no encontrado en la conexión")
  }

  if (isInundada || isRoto || isFuga || isNoEncontrado) {
    return {
      category: "valida",
      criticality: 1,
      incidencias,
    }
  }

  // 4. Nivel 2: Muy deficiente (escombros / basura masiva)
  const isEscombros =
    all.includes("escombros") ||
    all.includes("gran cantidad de basura") ||
    all.includes("abundante basura") ||
    all.includes("desperdicios") ||
    all.includes("trapos") ||
    all.includes("suciedad extrema")
  if (isEscombros) {
    incidencias.push("Caja con acumulación severa de escombros, basura o desperdicios")
    return {
      category: "valida",
      criticality: 2,
      incidencias,
    }
  }

  // 4b. Nivel 2: placa o protector del medidor en estado oxidado. Es un
  // elemento de protección degradado, no suciedad del entorno, así que pesa
  // más que un Nivel 3 genérico sin llegar a ser un daño crítico del medidor.
  const isPlacaOxidada =
    (all.includes("placa protectora") ||
      all.includes("placa de proteccion") ||
      all.includes("protector del medidor") ||
      all.includes("protector de medidor")) &&
    (all.includes("oxidad") || all.includes("oxido"))
  if (isPlacaOxidada) {
    incidencias.push("Placa o protector del medidor en estado oxidado")
    return {
      category: "valida",
      criticality: 2,
      incidencias,
    }
  }

  // 4c. Nivel 2: conexión mojada/húmeda pero sin agua acumulada o encharcada
  // visible. Paso intermedio entre "humedad leve" (Nivel 3) e "inundación"
  // (Nivel 1). Solo aplica si el Nivel 1 no se disparó ya arriba.
  const isSemiMojado =
    !isInundada &&
    (all.includes("mojada sin agua acumulada") ||
      all.includes("mojado sin agua acumulada") ||
      all.includes("semi mojad") ||
      all.includes("semi humed") ||
      all.includes("conexion mojada sin agua acumulada"))
  if (isSemiMojado) {
    incidencias.push("Conexión mojada o húmeda, sin agua acumulada ni encharcada visible")
    return {
      category: "valida",
      criticality: 2,
      incidencias,
    }
  }

  // 5. Nivel 3: Deficiente / Observación (barro, tierra, mantenimiento menor)
  const isDeficiente =
    all.includes("barro") ||
    all.includes("tierra") ||
    all.includes("polvo") ||
    all.includes("suciedad") ||
    all.includes("oxidacion") ||
    all.includes("deterioro menor") ||
    all.includes("caja averiada con lectura")
  if (isDeficiente) {
    incidencias.push("Acumulación moderada de tierra, barro o deterioro menor de caja")
  }

  return {
    category: "valida",
    criticality: 3,
    incidencias,
  }
}

export function consolidateSupplyPhotos(
  nis: string,
  photos: SupplyPhotoItem[]
): SupplyConsolidatedReport {
  const totalFotos = photos.length
  let fotosValidas = 0
  let fotosNoConcluyentes = 0
  let fotosNoRelacionadas = 0

  let bestNumeroMedidor = NO_VISIBLE
  let bestLectura = NO_VISIBLE
  let bestEstadoMedidor = ""
  let bestEstadoMedidorHasEvidence = false
  let bestEstadoConexion = ""
  let bestEstadoConexionHasEvidence = false
  const allIncidencias: string[] = []

  let minCritValida: CriticalityLevel | null = null
  let hasMeterSeen = false
  let hasMeterMissing = false
  let hasInundacion = false
  let hasMeterSevereDamage = false
  let hasConnectionSevereDamage = false

  // La observación de la foto que disparó cada condición, para que la
  // conclusión consolidada cite lo que la IA describió en ese suministro en
  // particular en vez de repetir la misma frase genérica en todos los casos
  // que comparten un mismo nivel de criticidad.
  let inundacionObservacion: string | null = null
  let meterMissingObservacion: string | null = null
  let connectionDamageObservacion: string | null = null
  let meterDamageObservacion: string | null = null

  for (const foto of photos) {
    if (foto.category === "valida") {
      fotosValidas += 1
      minCritValida = minCritValida === null ? foto.criticality : (Math.min(minCritValida, foto.criticality) as CriticalityLevel)

      if (foto.numeroMedidor && foto.numeroMedidor !== NO_VISIBLE) {
        bestNumeroMedidor = foto.numeroMedidor
      }
      if (/^\d+$/.test(foto.lectura.trim())) {
        bestLectura = foto.lectura.trim()
      }

      const lowerCon = foto.estadoConexion.toLowerCase()
      const lowerMed = foto.estadoMedidor.toLowerCase()
      const lowerObs = foto.observacion.toLowerCase()

      // Ojo: "agua" a secas también hace match en "Sin Agua Acumulada" (la
      // etiqueta de humedad sin inundación), así que se exige la frase
      // completa en vez del sustantivo suelto.
      if (lowerCon.includes("inundad") || lowerCon.includes("agua acumulada") || lowerCon.includes("encharcad") || lowerCon.includes("anegad")) {
        hasInundacion = true
        if (inundacionObservacion === null) {
          inundacionObservacion = foto.observacion
        }
      }

      // Distingue si el daño severo (Nivel 1) de alguna toma es del medidor en
      // sí o de la caja/conexión, revisando cada campo por separado en vez del
      // texto combinado: así la conclusión no le echa la culpa al medidor
      // cuando lo roto es solo la caja (o viceversa).
      if (
        lowerMed.includes("roto") ||
        lowerMed.includes("destruid") ||
        lowerMed.includes("manipulad") ||
        lowerMed.includes("averiad") ||
        lowerMed.includes("luna rota")
      ) {
        hasMeterSevereDamage = true
        if (meterDamageObservacion === null) {
          meterDamageObservacion = foto.observacion
        }
      }
      if (
        lowerCon.includes("rotur") ||
        lowerCon.includes("roto") ||
        lowerCon.includes("destruid") ||
        lowerCon.includes("rajad") ||
        lowerCon.includes("quebrad") ||
        lowerCon.includes("fuga") ||
        lowerObs.includes("fuga evidente") ||
        lowerObs.includes("conexion con fuga")
      ) {
        hasConnectionSevereDamage = true
        if (connectionDamageObservacion === null) {
          connectionDamageObservacion = foto.observacion
        }
      }

      // Un número de medidor o una lectura numérica visibles son evidencia
      // directa de que el medidor existe físicamente, aunque otra toma del
      // mismo suministro no lo haya captado. Esa evidencia tiene prioridad
      // sobre un "no encontrado" reportado en otra toma.
      const meterPresentEvidence = foto.numeroMedidor !== NO_VISIBLE || /^\d+$/.test(foto.lectura.trim())
      if (meterPresentEvidence) {
        hasMeterSeen = true
      } else if (lowerMed.includes("no encontrado")) {
        hasMeterMissing = true
        if (meterMissingObservacion === null) {
          meterMissingObservacion = foto.observacion
        }
      }

      if (!bestEstadoMedidor || bestEstadoMedidor === NO_VISIBLE || (meterPresentEvidence && !bestEstadoMedidorHasEvidence)) {
        bestEstadoMedidor = foto.estadoMedidor
        bestEstadoMedidorHasEvidence = meterPresentEvidence
      }
      if (!bestEstadoConexion || bestEstadoConexion === NO_VISIBLE || (meterPresentEvidence && !bestEstadoConexionHasEvidence)) {
        bestEstadoConexion = foto.estadoConexion
        bestEstadoConexionHasEvidence = meterPresentEvidence
      }
    } else if (foto.category === "noConcluyente") {
      fotosNoConcluyentes += 1
    } else {
      fotosNoRelacionadas += 1
    }
  }

  let nivelCriticidad: CriticalityLevel = 3
  let descripcionNivel = "Deficiente / Observación"
  let accionSugerida = "Limpieza y mantenimiento"
  let conclusionConsolidada = ""

  if (fotosValidas > 0) {
    nivelCriticidad = minCritValida ?? 3
    // La conclusión consolidada cita la observación que la IA escribió para
    // *este* suministro en vez de una frase fija repetida en todos los casos
    // del mismo nivel; el texto fijo queda solo como respaldo para cuando la
    // observación llegó vacía o en blanco.
    const representativeObservacion =
      photos.find((foto) => foto.category === "valida" && foto.criticality === nivelCriticidad && usableObservacion(foto.observacion))
        ?.observacion ?? null

    if (nivelCriticidad === 1) {
      descripcionNivel = "Crítico"
      accionSugerida = "Atención inmediata"
      // "No encontrado" solo se confirma si ninguna otra toma del mismo
      // suministro mostró evidencia del medidor (número o lectura visibles).
      const meterConfirmedMissing = hasMeterMissing && !hasMeterSeen
      if (hasInundacion) {
        allIncidencias.push("Caja de conexión inundada o con gran acumulación de agua.")
        conclusionConsolidada =
          usableObservacion(inundacionObservacion) ??
          usableObservacion(representativeObservacion) ??
          "Se identifica caja de conexión inundada con agua acumulada que compromete la instalación y la visibilidad del medidor."
      } else if (meterConfirmedMissing) {
        allIncidencias.push("Medidor no encontrado cuando debería existir.")
        conclusionConsolidada =
          usableObservacion(meterMissingObservacion) ??
          usableObservacion(representativeObservacion) ??
          "Se confirma medidor no encontrado en la conexión de agua potable."
      } else if (hasConnectionSevereDamage && !hasMeterSevereDamage) {
        allIncidencias.push("Conexión o caja con rotura, fuga o daño crítico evidente.")
        conclusionConsolidada =
          usableObservacion(connectionDamageObservacion) ??
          usableObservacion(representativeObservacion) ??
          "Existe evidencia visual de daño severo en la conexión de agua potable; el medidor no presenta daño en las tomas analizadas."
      } else if (hasMeterSevereDamage && !hasConnectionSevereDamage) {
        allIncidencias.push("Medidor o visor con rotura o daño crítico evidente.")
        conclusionConsolidada =
          usableObservacion(meterDamageObservacion) ??
          usableObservacion(representativeObservacion) ??
          "Existe evidencia visual de daño severo o rotura en el medidor."
      } else {
        allIncidencias.push("Medidor, visor o conexión con daño crítico evidente.")
        conclusionConsolidada =
          usableObservacion(representativeObservacion) ??
          "Existe evidencia visual de daño severo o rotura en el medidor o conexión en las fotografías analizadas."
      }
    } else if (nivelCriticidad === 2) {
      descripcionNivel = "Muy deficiente"
      accionSugerida = "Limpieza y mantenimiento prioritario"
      allIncidencias.push("Caja con acumulación abundante de escombros y desperdicios.")
      conclusionConsolidada =
        usableObservacion(representativeObservacion) ??
        "El medidor existe, pero se observa acumulación severa de escombros y basura dentro de la caja que dificulta la inspección técnica."
    } else {
      descripcionNivel = "Deficiente / Observación"
      accionSugerida = "Limpieza y mantenimiento"
      allIncidencias.push("Suciedad, barro o desgaste menor de mantenimiento en caja o medidor.")
      conclusionConsolidada =
        usableObservacion(representativeObservacion) ??
        "La conexión se encuentra operativa y el medidor es identificable, requiriendo limpieza y mantenimiento preventivo."
    }
  } else if (fotosNoConcluyentes > 0) {
    nivelCriticidad = 4
    descripcionNivel = "Imagen insuficiente / No concluyente"
    accionSugerida = "Nueva fotografía"
    const obs = photos.find((foto) => foto.category === "noConcluyente" && usableObservacion(foto.observacion))?.observacion ?? null
    conclusionConsolidada =
      usableObservacion(obs) ??
      "No se dispone de suficiente evidencia visual: las tomas del suministro están desenfocadas, empañadas o no permiten determinar el estado de la conexión."
  } else {
    nivelCriticidad = 5
    descripcionNivel = "Foto no válida / No corresponde"
    accionSugerida = "Nueva inspección"
    const obs = photos.find((foto) => foto.category === "noRelacionada" && usableObservacion(foto.observacion))?.observacion ?? null
    conclusionConsolidada = usableObservacion(obs) ?? "Las fotografías analizadas no muestran la caja, conexión ni medidor de agua potable."
  }

  const medidorEncontrado =
    hasMeterSeen || (bestNumeroMedidor && bestNumeroMedidor !== NO_VISIBLE) || /^\d+$/.test(bestLectura)
      ? "Sí"
      : hasMeterMissing
      ? "No"
      : hasInundacion
      ? "No determinable (sumergido)"
      : fotosValidas > 0
      ? "Sí"
      : "No determinable"

  const lecturaVisible = /^\d+$/.test(bestLectura) ? "Sí" : bestLectura === "Dudoso" || bestLectura === "Parcial" ? "Parcial" : "No"

  return {
    suministro: nis,
    totalFotos,
    fotosValidas,
    fotosNoConcluyentes,
    fotosNoRelacionadas,
    medidorEncontrado,
    lecturaVisible,
    numeroMedidor: bestNumeroMedidor,
    lectura: bestLectura,
    estadoMedidor: bestEstadoMedidor || NO_VISIBLE,
    estadoConexion: bestEstadoConexion || NO_VISIBLE,
    incidenciasDetectadas: Array.from(new Set(allIncidencias)),
    nivelCriticidad,
    descripcionNivel,
    conclusionConsolidada,
    accionSugerida,
    fotos: photos,
  }
}

/**
 * Agrupa una lista de resultados de la base de datos (MeterResult) por NIS
 * y genera los reportes consolidados correspondientes.
 */
export function consolidateMeterResults(results: MeterResult[]): SupplyConsolidatedReport[] {
  const groups = new Map<string, SupplyPhotoItem[]>()

  for (const row of results) {
    const { nis, photoIndex } = extractSupplyNis(row.file_name)
    const numeroMedidor = row.numero_medidor ?? NO_VISIBLE
    const lectura = row.lectura ?? NO_VISIBLE
    const estadoConexion = row.estado_conexion ?? NO_VISIBLE
    const estadoMedidor = row.estado_medidor ?? NO_VISIBLE
    const observacion = row.observacion ?? ""
    const { category, criticality } = evaluatePhoto(numeroMedidor, lectura, estadoConexion, estadoMedidor, observacion, row.status)

    const item: SupplyPhotoItem = {
      fileName: row.file_name,
      filePath: row.file_path,
      photoIndex,
      category,
      criticality,
      numeroMedidor,
      lectura,
      estadoConexion,
      estadoMedidor,
      observacion,
      status: row.status,
      runId: row.run_id,
    }

    if (!groups.has(nis)) {
      groups.set(nis, [])
    }
    groups.get(nis)?.push(item)
  }

  const reports: SupplyConsolidatedReport[] = []
  for (const [nis, photos] of groups.entries()) {
    reports.push(consolidateSupplyPhotos(nis, photos))
  }

  return reports.sort((a, b) => a.nivelCriticidad - b.nivelCriticidad || a.suministro.localeCompare(b.suministro))
}

/**
 * Agrupa filas activas de la cola (QueueRow) por NIS.
 */
export function consolidateQueueRows(rows: QueueRow[]): SupplyConsolidatedReport[] {
  const groups = new Map<string, SupplyPhotoItem[]>()

  for (const row of rows) {
    const { nis, photoIndex } = extractSupplyNis(row.fileName)
    const numeroMedidor = row.report?.numeroMedidor ?? NO_VISIBLE
    const lectura = row.report?.lectura ?? NO_VISIBLE
    const estadoConexion = row.report?.estadoConexion ?? NO_VISIBLE
    const estadoMedidor = row.report?.estadoMedidor ?? NO_VISIBLE
    const observacion = row.report?.observacion ?? ""
    const { category, criticality } = evaluatePhoto(numeroMedidor, lectura, estadoConexion, estadoMedidor, observacion, row.status)

    const item: SupplyPhotoItem = {
      fileName: row.fileName,
      filePath: row.filePath,
      photoIndex,
      category,
      criticality,
      numeroMedidor,
      lectura,
      estadoConexion,
      estadoMedidor,
      observacion,
      status: row.status,
      runId: null,
    }

    if (!groups.has(nis)) {
      groups.set(nis, [])
    }
    groups.get(nis)?.push(item)
  }

  const reports: SupplyConsolidatedReport[] = []
  for (const [nis, photos] of groups.entries()) {
    reports.push(consolidateSupplyPhotos(nis, photos))
  }

  return reports.sort((a, b) => a.nivelCriticidad - b.nivelCriticidad || a.suministro.localeCompare(b.suministro))
}
