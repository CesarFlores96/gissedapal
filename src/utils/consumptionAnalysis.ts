import type { ReportEvolutionRow, SupplyReport } from "../types"

/**
 * Motor de causa raíz del consumo.
 *
 * Barre **todas** las tablas operativas que el backend adjunta al reporte
 * (lecturas comerciales, tomas de estado, inspecciones, supervisiones de campo,
 * planillas, órdenes de trabajo, parque/padrón de medidores, contrastaciones,
 * anomalías y notas de refacturación) y las ancla al mes al que pertenecen,
 * para que la línea de tiempo pueda explicar mes por mes qué ocurrió.
 */

export type EvidenceCategory =
  | "reading"
  | "stateReading"
  | "inspection"
  | "supervision"
  | "planilla"
  | "workOrder"
  | "meter"
  | "registry"
  | "contrastation"
  | "anomaly"
  | "adjustment"

/** Qué tan cerca del mes analizado ocurrió el hecho. */
export type EvidenceRelevance = "month" | "window" | "background"

export type ConsumptionEvidence = {
  category: EvidenceCategory
  relevance: EvidenceRelevance
  /** Fecha normalizada `YYYY-MM-DD` cuando se pudo derivar. */
  date: string | null
  title: string
  fields: Array<{ label: string; value: string }>
  supplyCode?: string
}

export type MonthStatus = "normal" | "zero" | "low" | "high" | "anomaly" | "missing" | "future"

export type MonthTimelineEntry = {
  key: string
  year: number
  month: number
  monthName: string
  shortName: string
  label: string
  volume: number | null
  median: number | null
  previousVolume: number | null
  variationPercent: number | null
  status: MonthStatus
  statusLabel: string
  /** El mes se aparta de lo esperado y merece explicación. */
  needsExplanation: boolean
  evidence: ConsumptionEvidence[]
  /** Hechos ocurridos dentro del mes exacto (subconjunto de `evidence`). */
  monthEvidenceCount: number
  suggestion: string | null
}

export const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  reading: "Lectura comercial",
  stateReading: "Toma de estado",
  inspection: "Inspección comercial",
  supervision: "Supervisión de campo",
  planilla: "Planilla",
  workOrder: "Orden de trabajo",
  meter: "Instalación de medidor",
  registry: "Padrón de medidores",
  contrastation: "Contrastación",
  anomaly: "Anomalía del sistema",
  adjustment: "Refacturación / nota",
}

export const STATUS_LABELS: Record<MonthStatus, string> = {
  normal: "Consumo regular",
  zero: "Consumo cero",
  low: "Baja significativa",
  high: "Alza significativa",
  anomaly: "Anomalía detectada",
  missing: "Sin lectura registrada",
  future: "Período aún no facturado",
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

const SHORT_MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** Meses hacia atrás que cada fuente puede explicar respecto del mes analizado. */
const LOOKBACK_MONTHS: Record<EvidenceCategory, number> = {
  reading: 1,
  stateReading: 1,
  inspection: 3,
  supervision: 3,
  planilla: 3,
  workOrder: 6,
  meter: 6,
  registry: 0,
  contrastation: 6,
  anomaly: 1,
  adjustment: 3,
}

const PLACEHOLDER_VALUES = new Set(["", "-", "--", "n/a", "na", "null", "none", "sin dato", "s/d"])

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text || PLACEHOLDER_VALUES.has(text.toLowerCase())) return null
  return text
}

/** Normaliza `YYYY-MM-DD…`, `DD/MM/YYYY` y timestamps ISO a `YYYY-MM-DD`. */
function parseDate(value: string | null | undefined): { iso: string; index: number } | null {
  const text = clean(value)
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    if (month < 1 || month > 12) return null
    return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, index: year * 12 + (month - 1) }
  }

  const legacy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text)
  if (legacy) {
    const day = Number(legacy[1])
    const month = Number(legacy[2])
    const year = Number(legacy[3])
    if (month < 1 || month > 12) return null
    return {
      iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      index: year * 12 + (month - 1),
    }
  }

  return null
}

function monthIndexOf(year: number, month: number): number {
  return year * 12 + (month - 1)
}

/** Primera fecha utilizable de una lista de candidatos. */
function firstDate(...candidates: Array<string | null | undefined>): { iso: string; index: number } | null {
  for (const candidate of candidates) {
    const parsed = parseDate(candidate)
    if (parsed) return parsed
  }
  return null
}

function fields(...entries: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = []
  for (const [label, raw] of entries) {
    const value = clean(raw)
    if (value) result.push({ label, value })
  }
  return result
}

function relevanceFor(
  category: EvidenceCategory,
  eventIndex: number,
  targetIndex: number,
): EvidenceRelevance | null {
  if (eventIndex === targetIndex) return "month"
  const distance = targetIndex - eventIndex
  if (distance > 0 && distance <= LOOKBACK_MONTHS[category]) return "window"
  return null
}

type Collector = (targetIndex: number) => ConsumptionEvidence[]

/**
 * Prepara un colector por tabla: normaliza cada fila una sola vez y luego
 * responde por mes. Evita reprocesar 100+ filas × 12 meses en cada render.
 */
function buildCollector<T>(
  category: EvidenceCategory,
  rows: T[] | undefined,
  toEntry: (row: T) => { date: { iso: string; index: number } | null; title: string; fields: Array<{ label: string; value: string }>; supplyCode?: string } | null,
): Collector {
  const prepared: Array<{ index: number; evidence: ConsumptionEvidence }> = []
  for (const row of rows ?? []) {
    const entry = toEntry(row)
    if (!entry?.date) continue
    prepared.push({
      index: entry.date.index,
      evidence: {
        category,
        relevance: "month",
        date: entry.date.iso,
        title: entry.title,
        fields: entry.fields,
        supplyCode: entry.supplyCode,
      },
    })
  }
  prepared.sort((a, b) => b.index - a.index)

  return (targetIndex) => {
    const found: ConsumptionEvidence[] = []
    for (const item of prepared) {
      const relevance = relevanceFor(category, item.index, targetIndex)
      if (relevance) found.push({ ...item.evidence, relevance })
    }
    return found
  }
}

/**
 * Último registro estrictamente anterior al mes analizado. Se usa para el estado
 * del parque de medidores: un cambio de equipo explica la variación aunque haya
 * ocurrido hace más de seis meses.
 */
function buildBackgroundCollector<T>(
  category: EvidenceCategory,
  rows: T[] | undefined,
  toEntry: (row: T) => { date: { iso: string; index: number } | null; title: string; fields: Array<{ label: string; value: string }>; supplyCode?: string } | null,
): Collector {
  const prepared: Array<{ index: number; evidence: ConsumptionEvidence }> = []
  for (const row of rows ?? []) {
    const entry = toEntry(row)
    if (!entry?.date) continue
    prepared.push({
      index: entry.date.index,
      evidence: {
        category,
        relevance: "background",
        date: entry.date.iso,
        title: entry.title,
        fields: entry.fields,
        supplyCode: entry.supplyCode,
      },
    })
  }
  prepared.sort((a, b) => b.index - a.index)

  return (targetIndex) => {
    const latest = prepared.find((item) => item.index <= targetIndex)
    return latest ? [latest.evidence] : []
  }
}

function buildCollectors(details: SupplyReport["details"]): Collector[] {
  return [
    buildCollector("reading", details.readings, (row) => {
      const date =
        firstDate(row.readingDate) ??
        (row.readingYear && row.readingMonth
          ? {
              iso: `${row.readingYear}-${String(row.readingMonth).padStart(2, "0")}-01`,
              index: monthIndexOf(row.readingYear, row.readingMonth),
            }
          : null)
      const incidences = [
        [row.incidenceCode1, row.incidenceDetail1],
        [row.incidenceCode2, row.incidenceDetail2],
      ]
        .map(([code, detail]) => [clean(code), clean(detail)].filter(Boolean).join(" — "))
        .filter(Boolean)
      const observation = clean(row.readingObservation)
      // Una lectura sin incidencia ni observación no explica nada: es ruido.
      if (!incidences.length && !observation) return null
      return {
        date,
        title: observation ?? incidences[0] ?? "Lectura registrada",
        fields: fields(
          ["Observación", observation],
          ["Incidencia", incidences[0]],
          ["Incidencia 2", incidences[1]],
          ["Medidor", row.meterSerial],
          ["Lectura anterior", row.previousReading],
          ["Lectura actual", row.currentReading],
          ["Tarifa", row.tariffLabel],
          ["Ruta", row.routeCode],
        ),
        supplyCode: row.supplyCode,
      }
    }),

    buildCollector("stateReading", details.stateReadings, (row) => {
      const label = clean(row.incidenceLabel)
      const observation = clean(row.observation) ?? clean(row.incidenceDetail)
      if (!label && !observation) return null
      return {
        date: firstDate(row.readingDate),
        title: label ?? observation ?? "Toma de estado",
        fields: fields(
          ["Incidencia", label],
          ["Detalle", clean(row.incidenceDetail)],
          ["Observación", clean(row.observation)],
          ["Tipo de lectura", row.readingType],
          ["Medidor", row.meterSerial],
          ["Tipo de medidor", row.meterType],
          ["Diámetro", row.diameterMm],
          ["Lectura", row.readingValue],
        ),
        supplyCode: row.supplyCode,
      }
    }),

    buildCollector("inspection", details.inspections, (row) => ({
      date: firstDate(row.visitDate, row.inspectionDate),
      title: clean(row.result) ?? clean(row.typology) ?? "Inspección comercial",
      fields: fields(
        ["Resultado", row.result],
        ["Tipología", row.typology],
        ["Estado del servicio", row.serviceStatus],
        ["Observación", row.observation],
        ["Orden de servicio", row.workOrderNumber],
        ["Medidor", row.meterSerial],
        ["Lectura", row.readingValue],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("supervision", details.supervisions, (row) => ({
      date: firstDate(row.visitDate, row.completedAt, row.resolutionDate, row.createdAt),
      title:
        clean(row.generalObservation) ??
        clean(row.typology) ??
        (clean(row.workOrderNumber) ? `Supervisión OS ${clean(row.workOrderNumber)}` : "Supervisión de campo"),
      fields: fields(
        ["Tipología", row.typology],
        ["Orden de servicio", row.workOrderNumber],
        ["Estado", row.status],
        ["Supervisor", row.supervisor],
        ["Observación general", row.generalObservation],
        ["Observación", row.observation],
        ["Observación de campo", row.fieldObservation],
        ["Abastecimiento", row.supplyStatus],
        ["Estado del suministro", row.serviceStatus],
        ["Incidencia del medidor", row.meterIncident],
        ["Medidor", row.meterSerial],
        ["Lectura", row.readingValue],
        ["Clandestino", row.clandestineStatus],
        ["Detalle clandestino", row.clandestineDetail],
        ["Imposibilidad", row.impossibility],
        ["Motivo de no ingreso", row.noEntryReason],
        ["Acceso al inmueble", row.propertyAccess],
        ["Ubicación del predio", row.propertyLocation],
        ["Fuga en caja", row.boxLeak],
        ["Estado de caja", row.boxState],
        ["Estado de tapa", row.lidState],
        ["Precinto", row.seal],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("planilla", details.planillas, (row) => ({
      date: firstDate(row.recordDate, row.completedAt),
      title: clean(row.observation) ?? clean(row.requestingArea) ?? "Planilla de campo",
      fields: fields(
        ["Observación", row.observation],
        ["Área solicitante", row.requestingArea],
        ["Carga", row.load],
        ["Supervisor", row.supervisor],
        ["Medidor", row.meterSerial],
        ["Lectura", row.readingValue],
        ["Estado", row.status],
        ["Ruta", row.routeCode],
        ["Itinerario", row.itineraryCode],
        ["Ciclo", row.cycleCode],
        ["Dirección", row.address],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("workOrder", details.workOrders, (row) => ({
      date: firstDate(row.completedAt, row.scheduledDate),
      title: clean(row.title) ?? clean(row.orderType) ?? `Orden ${row.code}`,
      fields: fields(
        ["Código", row.code],
        ["Tipo", row.orderType],
        ["Estado", row.status],
        ["Prioridad", row.priority],
        ["Programada", row.scheduledDate],
        ["Completada", row.completedAt],
        ["Descripción", row.description],
        ["Resultado", row.resultNotes],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("contrastation", details.contrastations, (row) => ({
      date: firstDate(row.testDate, row.scheduledDate, row.returnDate, row.claimDate),
      title: clean(row.result) ?? clean(row.contrastationType) ?? "Contrastación de medidor",
      fields: fields(
        ["Resultado", row.result],
        ["Tipo", row.contrastationType],
        ["Ensayo", row.testType],
        ["Estado", row.status],
        ["Medidor", row.meterSerial],
        ["Marca", row.brand],
        ["Diámetro", row.diameterMm],
        ["Error permanente", row.relativeErrorPermanent != null ? `${row.relativeErrorPermanent} %` : null],
        ["Error transición", row.relativeErrorTransition != null ? `${row.relativeErrorTransition} %` : null],
        ["Error mínimo", row.relativeErrorMinimum != null ? `${row.relativeErrorMinimum} %` : null],
        ["Informe", row.reportNumber],
        ["Reclamo", row.claimCode],
        ["Orden", row.orderNumber],
        ["Observación", row.observation],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("anomaly", details.anomalies, (row) => ({
      date: firstDate(row.detectedAt),
      title: clean(row.anomalyType) ?? "Anomalía detectada",
      fields: fields(
        ["Tipo", row.anomalyType],
        ["Estado", row.status],
        ["Resuelta", row.resolved ? "Sí" : "No"],
        ["Resuelta el", row.resolvedAt],
        ["Valor detectado", row.detectedValue],
        ["Valor esperado", row.expectedValue],
        ["Desviación", row.deviationPercent != null ? `${row.deviationPercent} %` : null],
        ["Obs. de lectura", row.readingObservation],
        ["Obs. de facturación", row.billingObservation],
        ["Obs. de inspección", row.inspectionObservation],
        ["Notas de resolución", row.resolutionNotes],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("adjustment", details.billingAdjustments, (row) => ({
      date: firstDate(row.issueDate),
      title: clean(row.reason) ?? clean(row.noteType) ?? "Nota de refacturación",
      fields: fields(
        ["Motivo", row.reason],
        ["Tipo de nota", row.noteType],
        ["Documento", [clean(row.documentType), clean(row.documentNumber)].filter(Boolean).join(" ")],
        ["Importe", row.totalAmount != null ? `${row.currency ?? "S/"} ${row.totalAmount}` : null],
        ["Observación", row.observation],
        ["Registrado por", row.createdByUser],
      ),
      supplyCode: row.supplyCode,
    })),

    buildCollector("meter", details.meterInstallations, (row) => ({
      date: firstDate(row.installationDate, row.processDate),
      title: `Instalación de medidor ${clean(row.meterSerial) ?? "S/N"}`,
      fields: fields(
        ["Serie", row.meterSerial],
        ["Serie anterior", row.previousMeterSerial],
        ["Instalado", row.installationDate],
        ["Proceso", row.processDate],
        ["Diámetro", row.diameterMm],
        ["Estado", row.status],
        ["Lectura actual", row.currentReading],
        ["Lectura anterior", row.previousReading],
        ["Orden de trabajo", row.workOrderNumber],
        ["Orden de servicio", row.serviceOrderNumber],
        ["Observación", row.observation],
      ),
      supplyCode: row.supplyCode,
    })),

    // Fondo: qué equipo estaba vigente en ese mes según el padrón y la última
    // instalación conocida, aunque el cambio sea muy anterior al período.
    buildBackgroundCollector("meter", details.meterInstallations, (row) => ({
      date: firstDate(row.installationDate, row.processDate),
      title: `Medidor vigente: ${clean(row.meterSerial) ?? "S/N"}`,
      fields: fields(
        ["Serie", row.meterSerial],
        ["Serie anterior", row.previousMeterSerial],
        ["Instalado", row.installationDate],
        ["Estado", row.status],
        ["Diámetro", row.diameterMm],
        ["Observación", row.observation],
      ),
      supplyCode: row.supplyCode,
    })),

    buildBackgroundCollector("registry", details.meterRegistry, (row) => {
      const state = clean(row.registryStatus) ?? clean(row.currentState)
      if (!state) return null
      return {
        date: firstDate(row.importedAt),
        title: `Padrón: ${state}`,
        fields: fields(
          ["Medidor", row.meterSerial],
          ["Estado en padrón", row.registryStatus],
          ["Estado actual", row.currentState],
          ["Marca", row.brandCode],
          ["Diámetro", row.diameterCode],
          ["Tipo de lectura", row.readingType],
          ["Caja", row.boxType],
          ["Año de fabricación", row.manufacturedAt],
        ),
        supplyCode: row.supplyCode,
      }
    }),
  ]
}

function dedupe(items: ConsumptionEvidence[]): ConsumptionEvidence[] {
  const seen = new Set<string>()
  const result: ConsumptionEvidence[] = []
  for (const item of items) {
    const key = `${item.category}|${item.date ?? ""}|${item.title}|${item.supplyCode ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

const RELEVANCE_RANK: Record<EvidenceRelevance, number> = { month: 0, window: 1, background: 2 }

function resolveStatus(row: ReportEvolutionRow, isFuture: boolean): MonthStatus {
  if (isFuture) return "future"
  if (row.currentVolume === null) return "missing"
  if (row.currentVolume === 0) return "zero"
  if (row.isAnomaly) return "anomaly"
  if (row.historicalMedian !== null && row.historicalMedian > 0) {
    if (row.currentVolume < row.historicalMedian * 0.5) return "low"
    if (row.currentVolume > row.historicalMedian * 1.5) return "high"
  }
  return "normal"
}

/**
 * Valores que niegan su propia etiqueta. Un campo `Clandestino: No` no debe
 * activar la heurística de conexión clandestina solo porque la etiqueta
 * contiene la palabra: se descarta el par completo del texto analizado.
 */
const NEGATIVE_VALUES = new Set([
  "no", "n", "0", "no aplica", "ninguno", "ninguna", "sin", "false", "negativo",
])

/** Texto plano de una evidencia, para las heurísticas de sugerencia. */
function evidenceText(item: ConsumptionEvidence): string {
  const parts = [item.title]
  for (const field of item.fields) {
    if (NEGATIVE_VALUES.has(field.value.trim().toLowerCase())) continue
    parts.push(`${field.label} ${field.value}`)
  }
  return parts.join(" ").toLowerCase()
}

function buildSuggestion(status: MonthStatus, evidence: ConsumptionEvidence[]): string | null {
  if (status === "normal" || status === "future") return null

  // Solo los hechos fechados dentro del mes o su ventana pueden ser *causa*.
  // El contexto de fondo (medidor vigente, padrón) acompaña a todos los meses
  // por definición, así que nunca debe decidir la sugerencia: si lo hiciera,
  // todos los meses recibirían el mismo texto de "cambio de medidor".
  const direct = evidence.filter((item) => item.relevance !== "background")
  const directHaystack = direct.map(evidenceText).join(" ")
  const hasDirect = (...needles: string[]) => needles.some((needle) => directHaystack.includes(needle))

  if (hasDirect("clandest", "conexión directa", "conexion directa", "by pass", "bypass")) {
    return "Se detectó una conexión clandestina o directa en el período. El consumo facturado no refleja el consumo real: corresponde derivar el caso a recupero."
  }
  if (hasDirect("medidor parado", "medidor trabado", "no registra", "sin registro", "medidor malogrado", "inoperativo")) {
    return "Los registros de campo reportan el medidor detenido o inoperativo. El consumo nulo o bajo se explica por una falla del equipo de medición, no por el uso real."
  }
  if (hasDirect("fuga")) {
    return "Se reportaron fugas en la conexión o caja del medidor. Conviene contrastar la variación con la reparación registrada antes de imputarla al cliente."
  }
  if (hasDirect("corte", "clausur", "cerrado el servicio", "suspend", "retiro de conexión", "retiro de conexion")) {
    return "El historial muestra un corte, clausura o suspensión del servicio en el período. La caída de consumo es consecuencia esperada de la suspensión."
  }
  if (hasDirect("inaccesible", "no se pudo", "puerta cerrada", "predio cerrado", "imposibilidad", "no ingres", "sin acceso")) {
    return "Las lecturas del período no se pudieron tomar por falta de acceso al predio. El volumen facturado es probablemente un promedio o estimado normativo, no una lectura real."
  }
  if (hasDirect("deshabitad", "desocupad", "abandonad", "sin ocupante")) {
    return "El predio figura desocupado o deshabitado en las visitas del período. El consumo cero o mínimo es consistente con esa condición."
  }
  if (hasDirect("contrastación", "contrastacion", "error permanente", "submedición", "submedicion", "sobremedición", "sobremedicion")) {
    return "Existe una contrastación del medidor en el período. Revisar los errores relativos del ensayo: un equipo fuera de tolerancia explica la desviación del consumo."
  }
  if (hasDirect("nota de crédito", "nota de credito", "refactur", "reliquid")) {
    return "Se emitieron notas de refacturación sobre el período. El volumen mostrado puede corresponder a un ajuste comercial y no al consumo medido del mes."
  }
  if (hasDirect("instalación de medidor", "instalacion de medidor", "cambio de medidor", "serie anterior")) {
    return "Se instaló o cambió el medidor dentro de los meses previos. Es posible que la variación provenga de la lectura inicial del nuevo equipo o de su calibración."
  }
  if (direct.length > 0) {
    // Nombrar las fuentes evita el texto genérico idéntico mes a mes: cada mes
    // menciona exactamente qué tablas tienen algo que decir sobre él.
    const sources = [...new Set(direct.map((item) => CATEGORY_LABELS[item.category]))]
    return `Hay ${direct.length} registro(s) operativos en el período (${sources.join(", ")}) sin una causa típica reconocible. Revisar el detalle listado para correlacionarlo con la variación observada.`
  }
  if (status === "missing") {
    return "No hay lectura facturada para este mes ni registros operativos que lo justifiquen. Verificar la toma de estado del ciclo correspondiente."
  }
  if (evidence.length > 0) {
    return "Solo se conoce el estado vigente del parque de medidores; ninguna tabla operativa registra eventos fechados en el período. Se recomienda programar una inspección de campo."
  }
  return "Ninguna tabla operativa (lecturas, inspecciones, supervisiones, planillas, órdenes de trabajo, medidores, contrastaciones ni anomalías) registra eventos que expliquen esta variación. Se recomienda programar una inspección de campo."
}

/**
 * Construye la línea de tiempo completa del año: **todos** los meses, no solo
 * los anómalos, para que la UI pueda dibujar un riel continuo y abrir el detalle
 * de cualquier punto.
 */
export function buildConsumptionTimeline(
  selectedYear: number,
  evolutionRows: ReportEvolutionRow[],
  details: SupplyReport["details"] | null | undefined,
): MonthTimelineEntry[] {
  if (!evolutionRows.length) return []

  const collectors = details ? buildCollectors(details) : []
  const now = new Date()
  const currentIndex = monthIndexOf(now.getFullYear(), now.getMonth() + 1)

  return evolutionRows.map((row) => {
    const year = row.year || selectedYear
    const targetIndex = monthIndexOf(year, row.month)
    const isFuture = targetIndex > currentIndex
    const status = resolveStatus(row, isFuture)

    const evidence = isFuture
      ? []
      : dedupe(collectors.flatMap((collect) => collect(targetIndex))).sort((a, b) => {
          const byRelevance = RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance]
          if (byRelevance !== 0) return byRelevance
          return (b.date ?? "").localeCompare(a.date ?? "")
        })

    return {
      key: `${year}-${String(row.month).padStart(2, "0")}`,
      year,
      month: row.month,
      monthName: MONTH_NAMES[row.month - 1] ?? String(row.month),
      shortName: SHORT_MONTH_NAMES[row.month - 1] ?? String(row.month),
      label: row.label || MONTH_NAMES[row.month - 1] || String(row.month),
      volume: row.currentVolume,
      median: row.historicalMedian,
      previousVolume: row.previousVolume,
      variationPercent: row.variationVsMedianPercent,
      status,
      statusLabel: STATUS_LABELS[status],
      needsExplanation: status !== "normal" && status !== "future",
      evidence,
      monthEvidenceCount: evidence.filter((item) => item.relevance === "month").length,
      suggestion: buildSuggestion(status, evidence),
    }
  })
}
