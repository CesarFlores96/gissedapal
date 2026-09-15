import { invoke } from "@tauri-apps/api/core"
import type { GraphFilters, IncidenceGraph, LocalMeterItem, LocalMeterRun, MeterConfigBundle, MeterLabel, MeterResult, MeterRule, MeterRun, Paginated, PromptTemplate, ScanResult, ScanSummary, MeterReport, SupplyConsolidatedReport } from "./types"

export const meterApi = {
  pickFolder: () => invoke<string | null>("pick_meter_photo_folder"),
  scan: (folder: string, includeSubfolders: boolean) => invoke<ScanSummary>("scan_meter_photo_folder", { folder, includeSubfolders }),
  sample: (folder: string) => invoke<ScanResult>("sample_meter_photo_folder", { folder }),
  start: (folder: string, includeSubfolders: boolean, excluded?: string[]) => invoke("start_meter_analysis", { folder, includeSubfolders, excluded: excluded?.length ? excluded : null }),
  cancel: () => invoke<void>("cancel_meter_analysis"),
  pause: () => invoke<void>("pause_meter_analysis"),
  resume: (runId: string, folder: string) => invoke("resume_meter_analysis", { runId, folder }),
  localRuns: () => invoke<LocalMeterRun[]>("list_local_meter_runs"),
  localItems: (runId: string, page = 1, search?: string) => invoke<Paginated<LocalMeterItem>>("list_local_meter_items", { runId, page, pageSize: 100, search: search || null }),
  retryPersistence: () => invoke<void>("retry_meter_persistence"),
  retry: (runId: string, filePath: string) => invoke<void>("retry_meter_analysis_file", { runId, filePath }),
  reanalyze: (sourceRunId: string, filePath: string) => invoke<void>("reanalyze_meter_photo", { sourceRunId, filePath }),
  config: () => invoke<MeterConfigBundle>("get_meter_analysis_config"),
  saveOllama: (settings: Record<string, string | number>, apiKey?: string) => invoke<Pick<MeterConfigBundle, "ollama">>("save_meter_ollama_config", { settings, apiKey: apiKey || null }),
  testConnection: () => invoke("test_meter_ollama_connection"),
  labels: () => invoke<{ data: MeterLabel[] }>("list_meter_labels"),
  rules: () => invoke<{ data: MeterRule[] }>("list_meter_rules"),
  saveLabel: (label: { id?: string; name: string; description: string | null; sortOrder: number; isActive: boolean }) => invoke<MeterLabel>("save_meter_label", { label }),
  deleteLabel: (id: string) => invoke<{ deleted: boolean }>("delete_meter_label", { id }),
  deleteRule: (id: string) => invoke<{ deleted: boolean }>("delete_meter_rule", { id }),
  saveRule: (rule: { id?: string; content: string; priority: number; isActive: boolean }) => invoke<MeterRule>("save_meter_rule", { rule }),
  prompts: () => invoke<{ data: PromptTemplate[] }>("list_meter_prompts"),
  savePrompt: (prompt: { name: string; body: string; activate: boolean }) => invoke<PromptTemplate>("save_meter_prompt", { prompt }),
  activatePrompt: (id: string) => invoke<PromptTemplate>("activate_meter_prompt", { id }),
  testPrompt: (path: string, body: string) => invoke<MeterReport>("test_meter_prompt", { path, body }),
  deleteRun: (id: string) => invoke<{ deleted: number }>("delete_meter_run", { id }),
  deleteAllRuns: () => invoke<{ deleted: number }>("delete_all_meter_runs"),
  runs: (page = 1) => invoke<Paginated<MeterRun>>("list_meter_runs", { page, pageSize: 20 }),
  results: (filters: GraphFilters) => invoke<Paginated<MeterResult>>("list_meter_results", { filters }),
  consolidatedResults: (runId?: string) => invoke<SupplyConsolidatedReport[]>("get_meter_consolidated_results", { runId: runId ?? null }),
  graph: (filters: GraphFilters) => invoke<IncidenceGraph>("get_meter_incidence_graph", { filters }),
  export: (runId: string) => invoke<{ path: string; rowCount: number; suppliesCount?: number } | null>("export_meter_analysis_excel", { runId }),
  saveExport: (profile: Record<string, unknown>) => invoke("save_meter_export_profile", { profile }),
  photo: async (path: string) => {
    const response = await invoke<{ mimeType: string; base64: string }>("get_meter_photo", { path })
    return `data:${response.mimeType};base64,${response.base64}`
  },
}

/**
 * Un 404 desde cualquier ruta de este módulo significa una sola cosa: el
 * servidor todavía no tiene desplegado el router de fotos de medidores. El
 * "Not Found" crudo de FastAPI no le dice nada al usuario final, así que se
 * traduce a algo accionable en vez de dejarlo adivinando.
 */
function isModuleNotDeployed(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes("not found") || normalized.includes("404")
}

export function meterError(error: unknown): string {
  let message: string | null = null
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") message = error.message
  else if (typeof error === "string") message = error
  if (message === null) return "No se pudo completar la operación. Revisa la conexión y vuelve a intentar."
  if (isModuleNotDeployed(message)) {
    return "El servidor todavía no tiene habilitado el módulo de fotografías de medidores. Hay que aplicar las migraciones 019 y 020 y desplegar el backend; hasta entonces esta pantalla no puede cargar su configuración."
  }
  return message
}
