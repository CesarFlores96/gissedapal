import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"

import type { CadastreSearchResult, ConsumptionDropScan, DistrictOption, GeometryCorrectionInput, GeometryCorrectionResult, GisLayersResponse, LayerKey, RelationshipResult, ReportsMasterPage, SessionSnapshot, SupplyDetail, SupplyReport } from "../types"

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

export async function getSupplyReportHeader(supplyCode: string): Promise<SupplyReport["header"]> {
  return invoke("get_supply_report_header", { supplyCode })
}

export async function getSupplyReportSpatial(supplyCode: string): Promise<SupplyReport["indicators"]> {
  return invoke("get_supply_report_spatial", { supplyCode })
}

export async function getSupplyReportDetails(supplyCode: string): Promise<SupplyReport["details"]> {
  return invoke("get_supply_report_details", { supplyCode })
}

export async function getSupplyReportTemporal(supplyCode: string): Promise<Omit<SupplyReport, "header" | "indicators" | "details">> {
  return invoke("get_supply_report_temporal", { supplyCode })
}

export async function getAbruptConsumptionDrops(): Promise<ConsumptionDropScan> {
  return invoke("get_abrupt_consumption_drops")
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
