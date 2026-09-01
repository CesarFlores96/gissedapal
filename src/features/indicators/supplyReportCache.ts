import {
  getSupplyReportDetails,
  getSupplyReportHeader,
  getSupplyReportSpatial,
  getSupplyReportTemporal,
} from "../../lib/ipc"
import type { SupplyReport } from "../../types"

type ReportSnapshot = Partial<SupplyReport>
type ReportListener = (report: ReportSnapshot) => void
export type SupplyReportStage = "header" | "temporal" | "details" | "spatial"

const EMPTY_DETAILS: SupplyReport["details"] = {
  stateReadings: [], meterInstallations: [], workOrders: [], billing: [], anomalies: [], inspections: [],
}
const snapshots = new Map<string, ReportSnapshot>()
const pending = new Map<string, Promise<ReportSnapshot>>()
const spatialPending = new Map<string, Promise<ReportSnapshot>>()
const listeners = new Map<string, Set<ReportListener>>()
const loadedStages = new Map<string, Set<SupplyReportStage>>()

/**
 * Límite de reportes de suministro conservados en memoria durante la sesión.
 * Sin esto `snapshots` crecía sin fin al revisar decenas de suministros en un
 * turno de trabajo. Se evita evictar el de una ventana MDI abierta ahora
 * mismo con `setPinnedSupplyCodes`, para no romper una vista que el usuario
 * tiene visible.
 */
const MAX_CACHED_REPORTS = 24
let pinnedSupplyCodes: ReadonlySet<string> = new Set()

export function setPinnedSupplyCodes(codes: Iterable<string>): void {
  pinnedSupplyCodes = new Set(codes)
}

/** Mueve `supplyCode` al extremo más reciente del orden de iteración (Map.set no reordena claves ya existentes). */
function touch(supplyCode: string): void {
  const existing = snapshots.get(supplyCode)
  if (existing === undefined) return
  snapshots.delete(supplyCode)
  snapshots.set(supplyCode, existing)
}

function evictIfOverCapacity(): void {
  if (snapshots.size <= MAX_CACHED_REPORTS) return
  for (const key of snapshots.keys()) {
    if (pinnedSupplyCodes.has(key)) continue
    invalidateSupplyReport(key)
    return
  }
}

function isComplete(report: ReportSnapshot | undefined): report is SupplyReport {
  return Boolean(report?.header && report.indicators && report.details && report.analysisByYear)
}

function publish(supplyCode: string, next: ReportSnapshot): void {
  snapshots.delete(supplyCode)
  snapshots.set(supplyCode, next)
  listeners.get(supplyCode)?.forEach((listener) => listener(next))
  evictIfOverCapacity()
}

function update(supplyCode: string, apply: (current: ReportSnapshot) => ReportSnapshot): void {
  publish(supplyCode, apply(snapshots.get(supplyCode) ?? { supplyCode }))
}

export function getSupplyReportSnapshot(supplyCode: string): ReportSnapshot | undefined {
  touch(supplyCode)
  return snapshots.get(supplyCode)
}

export function clearSupplyReportCache(): void {
  snapshots.clear()
  pending.clear()
  spatialPending.clear()
  loadedStages.clear()
  pinnedSupplyCodes = new Set()
}

export function subscribeSupplyReport(supplyCode: string, listener: ReportListener): () => void {
  const set = listeners.get(supplyCode) ?? new Set<ReportListener>()
  set.add(listener)
  listeners.set(supplyCode, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(supplyCode)
  }
}

export function invalidateSupplyReport(supplyCode: string): void {
  snapshots.delete(supplyCode)
  loadedStages.delete(supplyCode)
}

export function isSupplyReportStageLoaded(supplyCode: string, stage: SupplyReportStage): boolean {
  return loadedStages.get(supplyCode)?.has(stage) ?? false
}

function markLoaded(supplyCode: string, stage: SupplyReportStage): void {
  const stages = loadedStages.get(supplyCode) ?? new Set<SupplyReportStage>()
  stages.add(stage)
  loadedStages.set(supplyCode, stages)
}

/** Precarga bloques en serie y publica cada avance para todas las vistas MDI. */
export function preloadSupplyReport(supplyCode: string): Promise<ReportSnapshot> {
  const cached = snapshots.get(supplyCode)
  if (isComplete(cached)) return Promise.resolve(cached)
  const current = pending.get(supplyCode)
  if (current) return current

  const request = (async (): Promise<ReportSnapshot> => {
    const header = await getSupplyReportHeader(supplyCode)
    markLoaded(supplyCode, "header")
    publish(supplyCode, { supplyCode, header })

    try {
      const temporal = await getSupplyReportTemporal(supplyCode)
      const { billing, ...temporalReport } = temporal
      markLoaded(supplyCode, "temporal")
      update(supplyCode, (report) => ({ ...report, ...temporalReport, details: { ...(report.details ?? EMPTY_DETAILS), billing: billing ?? [] } }))
    } catch { /* Continuar con los demás bloques. */ }

    try {
      const details = await getSupplyReportDetails(supplyCode)
      markLoaded(supplyCode, "details")
      update(supplyCode, (report) => ({ ...report, details: { ...details, billing: report.details?.billing ?? [] } }))
    } catch { /* Continuar con el bloque espacial. */ }

    try {
      const indicators = await getSupplyReportSpatial(supplyCode)
      markLoaded(supplyCode, "spatial")
      update(supplyCode, (report) => ({ ...report, indicators }))
    } catch { /* Los bloques ya cargados permanecen disponibles. */ }

    return snapshots.get(supplyCode) ?? { supplyCode }
  })().finally(() => pending.delete(supplyCode))

  pending.set(supplyCode, request)
  return request
}

/** Revalida únicamente el bloque espacial y nunca compite con la cadena principal. */
export function refreshSupplyReportSpatial(supplyCode: string): Promise<ReportSnapshot> {
  const progressive = pending.get(supplyCode)
  if (progressive) return progressive
  const current = spatialPending.get(supplyCode)
  if (current) return current

  const request = getSupplyReportSpatial(supplyCode)
    .then((indicators) => {
      markLoaded(supplyCode, "spatial")
      update(supplyCode, (report) => ({ ...report, indicators }))
      return snapshots.get(supplyCode) ?? { supplyCode, indicators }
    })
    .finally(() => spatialPending.delete(supplyCode))
  spatialPending.set(supplyCode, request)
  return request
}
