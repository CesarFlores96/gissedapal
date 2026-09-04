import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"

import type { CadastreSearchResult, ClientLotReport, ConsumptionDropScan, DashboardPayload, DashboardTab, DistrictOption, GeometryCorrectionInput, GeometryCorrectionResult, GisLayersResponse, LayerKey, PlaceLocation, PlaceSuggestion, RelationshipResult, ReportsMasterPage, SessionSnapshot, SupplyDetail, SupplyEvidence, SupplyReport } from "../types"
import type { AgentContext, AgentHistoryMessage, AgentMode, AgentResponse } from "../features/agent/types"

/**
 * A diferencia del resto de este archivo, estas dos no pasan por `invoke()`:
 * usan el SDK de los plugins de updater/process directamente, que a su vez
 * hablan con Rust por su propio canal.
 */
export async function checkForUpdate(): Promise<Update | null> {
  return check()
}

export async function relaunchApp(): Promise<void> {
  return relaunch()
}

export async function login(identifier: string, password: string): Promise<SessionSnapshot> {
  return invoke("login", { identifier, password })
}

export async function logout(): Promise<void> {
  return invoke("logout")
}

export async function getSession(): Promise<SessionSnapshot> {
  return invoke("get_session")
}

export async function fetchGisLayers(input: {
  bbox: [number, number, number, number]
  layers: LayerKey[]
  page: number
  pageSize: number
  zoom: number
  district?: string
}): Promise<GisLayersResponse> {
  return invoke("fetch_gis_layers", { request: input })
}

function toTuple<N extends number>(value: unknown, length: N): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null
  return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? (value as number[]) : null
}

export async function fetchDistricts(): Promise<DistrictOption[]> {
  const response = await invoke<{
    districts: Array<{
      district_code: string | null
      name: string
      supply_count: number
      bounds?: unknown
      center?: unknown
    }>
  }>("fetch_districts")
  return response.districts.map((district) => ({
    code: district.district_code,
    name: district.name,
    supplyCount: district.supply_count,
    bounds: toTuple(district.bounds, 4) as [number, number, number, number] | null,
    center: toTuple(district.center, 2) as [number, number] | null,
  }))
}

export async function getSupplyDetail(supplyCode: string): Promise<SupplyDetail> {
  return invoke("get_supply_detail", { supplyCode })
}

export async function getSupplyConsumption(supplyCode: string): Promise<SupplyDetail["consumption"]> {
  return invoke("get_supply_consumption", { supplyCode })
}

export async function getSupplyReport(supplyCode: string): Promise<SupplyReport> {
  return invoke("get_supply_report", { supplyCode })
}

export async function getClientLotReport(supplyCodes: string[]): Promise<ClientLotReport> {
  return invoke("get_client_lot_report", { supplyCodes })
}

export async function getSupplyReportHeader(supplyCode: string): Promise<SupplyReport["header"]> {
  return invoke("get_supply_report_header", { supplyCode })
}

export async function getSupplyReportSpatial(supplyCode: string): Promise<SupplyReport["indicators"]> {
  return invoke("get_supply_report_spatial", { supplyCode })
}

export async function getSupplyReportDetails(supplyCode: string): Promise<SupplyReport["details"]> {
  return invoke("get_supply_report_details", { supplyCode })
}

export type SupplyReportTemporal = Omit<SupplyReport, "header" | "indicators" | "details"> & {
  /** La facturacion se obtiene junto con el analisis temporal, no con los detalles operativos. */
  billing: SupplyReport["details"]["billing"]
}

export async function getSupplyReportTemporal(supplyCode: string): Promise<SupplyReportTemporal> {
  return invoke("get_supply_report_temporal", { supplyCode })
}

export async function getSupplyEvidence(supplyCode: string): Promise<SupplyEvidence> {
  return invoke("get_supply_evidence", { supplyCode })
}

/**
 * Bytes de una evidencia, en base64.
 *
 * No se puede apuntar un `<img>` al API: la CSP no admite ese origen y la
 * peticion tampoco llevaria la cabecera de sesion. Rust descarga el archivo
 * autenticado y aqui se arma un data URL, que la CSP si permite.
 */
export async function getEvidenceMedia(path: string, thumb: boolean): Promise<string> {
  const media = await getEvidenceMediaParts(path, thumb)
  return `data:${media.mimeType};base64,${media.base64}`
}

/**
 * Variante cruda, para el video.
 *
 * Un `<video src="data:...">` no es fiable en el webview (no puede buscar dentro
 * del archivo), así que el llamador arma un Blob y usa una object URL.
 */
export async function getEvidenceMediaParts(path: string, thumb: boolean): Promise<{ mimeType: string; base64: string }> {
  return invoke("get_evidence_media", { path, thumb })
}

export async function getAbruptConsumptionDrops(
  page = 1,
  pageSize = 10,
  classification?: "grandes_clientes" | "fuente_propia" | "operativo",
  kind?: "zero" | "extremely_low",
  search = "",
  district = "",
  analysisScope: "supply" | "property" = "supply",
): Promise<ConsumptionDropScan> {
  return invoke("get_abrupt_consumption_drops", {
    page, pageSize, classification, kind, search, district, analysisScope,
  })
}

/**
 * Dashboard corporativo. `tab` limita la carga a las consultas de esa pestaña:
 * omitirlo pide el payload completo, que es notablemente más caro.
 */
export async function getDashboard(tab?: DashboardTab): Promise<DashboardPayload> {
  return invoke("get_dashboard", { tab })
}

export type CacheRevisions = {
  revisions: Record<string, number>
  pollAfterSeconds: number
}

export async function fetchCacheRevisions(): Promise<CacheRevisions> {
  return invoke<CacheRevisions>("fetch_gis_cache_revisions")
}

export async function sendAgentMessage(input: {
  message: string
  mode: AgentMode
  context: AgentContext
  history: AgentHistoryMessage[]
}): Promise<AgentResponse> {
  return invoke("send_agent_message", { payload: input })
}

export async function getReportsMaster(input: {
  page: number
  pageSize: number
  search: string
  filterActive: boolean
  trendDirection: "increasing" | "decreasing" | "either"
  minTrendPercent: number
  sortOrder?: "asc" | "desc"
  baselineStartPeriod: string
  baselineEndPeriod: string
  targetStartPeriod: string
  targetEndPeriod: string
}): Promise<ReportsMasterPage> {
  return invoke("get_reports_master", { request: input })
}

export async function resolveLocation(lng: number, lat: number): Promise<RelationshipResult> {
  return invoke("resolve_location", { lng, lat, toleranceM: 25 })
}

export async function searchCadastre(query: string): Promise<CadastreSearchResult[]> {
  const response = await invoke<{ results: CadastreSearchResult[] }>("search_cadastre", { query })
  return response.results
}

/** Sugerencias de lugares (tipo Google Maps), centradas cerca de `near` cuando se da. */
export async function searchPlaces(query: string, near?: { lat: number; lng: number }): Promise<PlaceSuggestion[]> {
  const response = await invoke<{ results: PlaceSuggestion[] }>("search_places", {
    query,
    lat: near?.lat,
    lng: near?.lng,
  })
  return response.results
}

/**
 * Resuelve una sugerencia elegida a coordenadas. `placeId` puede faltar en
 * sugerencias de categoría (p.ej. "Metro Station"); en ese caso el backend cae
 * a una búsqueda de texto sobre el mismo `label`.
 */
export async function resolvePlace(
  label: string,
  placeId: string | null,
  near?: { lat: number; lng: number },
): Promise<PlaceLocation | null> {
  return invoke("resolve_place", {
    text: label,
    placeId,
    lat: near?.lat,
    lng: near?.lng,
  })
}

export type MapsWindowMode = "satellite" | "streetview"

/**
 * Abre Google Maps en una ventana propia de la aplicación.
 *
 * Sólo se envían coordenadas y modo: la URL la arma Rust, de modo que este canal
 * no puede usarse para cargar un origen arbitrario en una ventana de la app.
 */
export async function openMapsWindow(lat: number, lng: number, mode: MapsWindowMode): Promise<void> {
  return invoke("open_maps_window", { lat, lng, mode })
}

export async function saveGeometryCorrection(input: GeometryCorrectionInput): Promise<GeometryCorrectionResult> {
  return invoke("save_geometry_correction", {
    targetKind: input.targetKind,
    targetId: input.targetId,
    deltaLng: input.deltaLng,
    deltaLat: input.deltaLat,
    reset: input.reset ?? false,
  })
}
