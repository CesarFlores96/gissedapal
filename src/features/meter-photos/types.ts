/**
 * Tipos del módulo de análisis masivo de fotografías de medidores.
 *
 * Viven acá y no en `src/types.ts` porque solo los usa esta feature, que además
 * carga en una ruta `lazy`: mantenerlos locales evita que el árbol de tipos
 * global crezca por algo que el resto de la app nunca toca.
 */

/** Los seis campos del informe, ya normalizados por la capa de Rust. */
export type MeterReport = {
  numeroMedidor: string
  lectura: string
  estadoConexion: string
  estadoMedidor: string
  observacion: string
  requiereRevision: boolean
}

export type ScannedFile = {
  fileName: string
  filePath: string
  sizeBytes: number
}

export type SkippedFile = {
  fileName: string
  reason: string
}

export type ScanResult = {
  folder: string
  files: ScannedFile[]
  skipped: SkippedFile[]
}

export type ScanSummary = {
  folder: string
  total: number
  skippedCount: number
}

export type QueueRowStatus = "pending" | "running" | "done" | "error" | "cancelled"

export type LocalMeterRun = {
  runId: string
  folder: string
  status: "preparing" | "running" | "paused" | "cancelled" | "completed"
  total: number
  pending: number
  processing: number
  done: number
  error: number
  needsAttention: number
  pendingSync: number
}

export type LocalMeterItem = {
  relativePath: string
  fileName: string
  sizeBytes: number
  modifiedMs: number
  sha256: string
  status: string
  attempts: number
  result: Record<string, unknown> | null
  attentionReason: string | null
}

export type QueueRow = {
  index: number
  fileName: string
  filePath: string
  status: QueueRowStatus
  report: MeterReport | null
  adjustments: string[]
  /** Se conserva aunque la fila se reintente: el error nunca desaparece solo. */
  errorMessage: string | null
  durationMs: number | null
}

export type QueueCounters = {
  processed: number
  pending: number
  ok: number
  review: number
  error: number
}

export type QueueState = {
  runId: string | null
  runToken: string | null
  folder: string | null
  total: number
  concurrency: number
  promptVersion: number | null
  status: "idle" | "running" | "cancelling" | "completed" | "cancelled"
  rows: QueueRow[]
  counters: QueueCounters
  /** Fallos de persistencia: la cola sigue, pero el usuario debe enterarse. */
  persistErrors: string[]
  startedAt: number | null
}

export type RunStartedEvent = {
  files?: ScannedFile[]
  runId: string
  runToken: string
  folder: string
  total: number
  concurrency: number
  promptVersion: number | null
  durable?: boolean
}

export type FileStartedEvent = {
  runToken: string
  index: number
  fileName: string
}

export type FileDoneEvent = {
  runToken: string
  index: number
  fileName: string
  filePath: string
  status: "done" | "error"
  report?: MeterReport
  adjustments: string[]
  errorMessage?: string
  durationMs: number
}

export type ProgressEvent = {
  runId?: string
  runToken: string
  processed: number
  pending: number
  ok: number
  review: number
  error: number
  concurrency?: number
}

export type RunFinishedEvent = {
  runToken: string
  runId: string
  status: "completed" | "cancelled"
  processed: number
  ok: number
  review: number
  error: number
  cancelled: boolean
}

export type PersistFailedEvent = {
  runToken: string
  count: number
  message: string
}

/** Configuración enmascarada: nunca trae ciphertext ni la key en claro. */
export type OllamaConfig = {
  host: string
  model: string
  temperature: number
  timeout_seconds: number
  concurrency: number
  max_image_side: number
  jpeg_quality: number
  api_key_hint: string | null
  api_key_updated_at: string | null
  hasApiKey: boolean
  canDecrypt: boolean
}

export type MeterLabel = {
  id: string
  name: string
  sort_order: number
  description: string | null
  is_active: boolean
}

export type MeterRule = {
  id: string
  content: string
  priority: number
  is_active: boolean
}

export type PromptTemplate = {
  id: string
  name: string
  body: string
  version: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MeterConfigBundle = {
  ollama: OllamaConfig
  labels: MeterLabel[]
  rules: MeterRule[]
  activePrompt: PromptTemplate | null
  exportProfile: { sheet_name: string; freeze_header: boolean; autofilter: boolean; columns: Array<{ key: string; header: string }> } | null
}

export type MeterRun = {
  id: string
  folder_path: string
  started_at: string
  finished_at: string | null
  status: string
  total_files: number
  processed_count: number
  ok_count: number
  review_count: number
  error_count: number
  attention_count: number
  prompt_version: number | null
  model: string | null
}

export type MeterResult = {
  id: string
  run_id: string
  file_name: string
  file_path: string
  status: string
  numero_medidor: string | null
  lectura: string | null
  estado_conexion: string | null
  estado_medidor: string | null
  observacion: string | null
  requiere_revision: boolean
  post_process_applied: string[]
  error_message: string | null
  analyzed_at: string | null
}

export type Paginated<T> = {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export type IncidenceNode = {
  incidence: string
  source: "estado_conexion" | "estado_medidor" | "etiqueta" | "revision"
  photo_count: number
}

export type IncidenceEdge = {
  source_incidence: string
  target_incidence: string
  weight: number
}

export type IncidenceGraph = {
  nodes: IncidenceNode[]
  edges: IncidenceEdge[]
  totalPhotos: number
}

export type IncidenceFile = {
  result_id: string
  file_name: string
  file_path: string
  numero_medidor: string | null
  lectura: string | null
  requiere_revision: boolean
  run_id: string
}

export type GraphFilters = {
  ejecucion?: string | null
  desde?: string | null
  hasta?: string | null
  requiereRevision?: boolean | null
  incidencia?: string | null
  q?: string | null
  page?: number
  pageSize?: number
  minEdgeWeight?: number
}

export type CriticalityLevel = 1 | 2 | 3 | 4 | 5

export type PhotoCategory = "valida" | "noConcluyente" | "noRelacionada"

export type SupplyPhotoItem = {
  fileName: string
  filePath: string
  photoIndex?: number | null
  category: PhotoCategory
  criticality: CriticalityLevel
  numeroMedidor: string
  lectura: string
  estadoConexion: string
  estadoMedidor: string
  observacion: string
  requiereRevision: boolean
  status: string
  /** Ejecución de origen, para que una corrección aislada conserve trazabilidad. */
  runId: string | null
}

export type SupplyConsolidatedReport = {
  suministro: string
  totalFotos: number
  fotosValidas: number
  fotosNoConcluyentes: number
  fotosNoRelacionadas: number
  medidorEncontrado: string
  lecturaVisible: string
  numeroMedidor: string
  lectura: string
  estadoMedidor: string
  estadoConexion: string
  incidenciasDetectadas: string[]
  nivelCriticidad: CriticalityLevel
  descripcionNivel: string
  conclusionConsolidada: string
  accionSugerida: string
  fotos: SupplyPhotoItem[]
}
