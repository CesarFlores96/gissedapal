/**
 * Máquina de estado de la cola de análisis. Pura: sin React, sin IPC, sin reloj
 * propio más que el que le pasan. Todo lo que llega por eventos de Tauri entra
 * por acá, y por eso es el punto de prueba principal del frontend.
 *
 * Dos invariantes que los tests fijan:
 *
 * 1. **Los errores no desaparecen.** Reintentar una fila la vuelve a `running`
 *    pero conserva `errorMessage` hasta que el reintento termine bien. No hay
 *    ningún camino que borre un error sin un resultado que lo reemplace.
 * 2. **Un evento de una corrida vieja se ignora.** Al cancelar y arrancar de
 *    nuevo, una respuesta tardía de la corrida anterior llega igual; sin el
 *    filtro por `runToken` corrompería los contadores de la corrida nueva.
 */

import type {
  FileDoneEvent,
  FileStartedEvent,
  PersistFailedEvent,
  ProgressEvent,
  QueueRow,
  QueueState,
  RunFinishedEvent,
  RunStartedEvent,
  ScanResult,
  ScanSummary,
} from "./types"

export const EMPTY_QUEUE_STATE: QueueState = {
  runId: null,
  runToken: null,
  folder: null,
  total: 0,
  concurrency: 1,
  promptVersion: null,
  status: "idle",
  rows: [],
  counters: { processed: 0, pending: 0, ok: 0, review: 0, error: 0 },
  persistErrors: [],
  startedAt: null,
}

export type QueueAction =
  | { type: "SCANNED"; scan: ScanResult | ScanSummary }
  | { type: "RUN_STARTED"; event: RunStartedEvent }
  | { type: "FILE_STARTED"; event: FileStartedEvent }
  | { type: "FILE_DONE"; event: FileDoneEvent }
  | { type: "PROGRESS"; event: ProgressEvent }
  | { type: "RUN_FINISHED"; event: RunFinishedEvent }
  | { type: "PERSIST_FAILED"; event: PersistFailedEvent }
  | { type: "CANCEL_REQUESTED" }
  | { type: "RETRY_STARTED"; filePath: string }
  | { type: "EXCLUDE_FILE"; filePath: string }
  | { type: "RESET" }
  | { type: "PERSISTED" }

/** Filas en estado inicial a partir del escaneo, para poder mostrar la lista
 *  completa (y su conteo) antes de arrancar. */
function rowsFromScan(scan: ScanResult): QueueRow[] {
  return scan.files.map((file, index) => ({
    index,
    fileName: file.fileName,
    filePath: file.filePath,
    status: "pending" as const,
    report: null,
    adjustments: [],
    errorMessage: null,
    durationMs: null,
  }))
}

/** Un evento pertenece a la corrida actual? Los de reintento (`retry:`) siempre
 *  se aceptan, porque corren fuera de la generación de la cola. */
function belongsToRun(state: QueueState, runToken: string): boolean {
  if (runToken.startsWith("retry:")) return runToken === `retry:${state.runId}`
  return state.runToken === runToken
}

function replaceRow(rows: QueueRow[], index: number, patch: Partial<QueueRow>): QueueRow[] {
  return rows.map((row) => (row.index === index ? { ...row, ...patch } : row))
}

function replaceRowByPath(rows: QueueRow[], filePath: string, patch: Partial<QueueRow>): QueueRow[] {
  return rows.map((row) => (row.filePath === filePath ? { ...row, ...patch } : row))
}

/** Recuenta desde las filas en vez de confiar en un acumulador.
 *  Un reintento cambia una fila de `error` a `done`, y sumar/restar deltas se
 *  desincroniza en cuanto un evento llega dos veces. */
function recount(rows: QueueRow[]): QueueState["counters"] {
  let ok = 0
  let review = 0
  let error = 0
  let processed = 0
  let pending = 0
  for (const row of rows) {
    if (row.status === "done") {
      processed += 1
      if (row.report?.requiereRevision) review += 1
      else ok += 1
    } else if (row.status === "error") {
      processed += 1
      error += 1
    } else if (row.status === "pending" || row.status === "running") {
      pending += 1
    }
  }
  return { processed, pending, ok, review, error }
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "SCANNED": {
      const rows = "files" in action.scan ? rowsFromScan(action.scan) : []
      const total = "files" in action.scan ? rows.length : action.scan.total
      return {
        ...EMPTY_QUEUE_STATE,
        folder: action.scan.folder,
        total,
        rows,
        counters: rows.length ? recount(rows) : { processed: 0, pending: total, ok: 0, review: 0, error: 0 },
      }
    }

    case "RUN_STARTED": {
      const { event } = action
      const hasLegacyRows = !event.durable
      const rows = event.files
        ? rowsFromScan({ folder: event.folder, files: event.files, skipped: [] })
        : hasLegacyRows ? state.rows : []
      return {
        ...state,
        // La lista detallada se consulta paginada desde SQLite. Nunca se
        // conserva el manifiesto completo en React durante una corrida masiva.
        rows,
        counters: hasLegacyRows ? recount(rows) : { processed: 0, pending: event.total, ok: 0, review: 0, error: 0 },
        runId: event.runId,
        runToken: event.runToken,
        folder: event.folder,
        total: event.total,
        concurrency: event.concurrency,
        promptVersion: event.promptVersion,
        status: "running",
        startedAt: Date.now(),
        persistErrors: [],
      }
    }

    case "FILE_STARTED": {
      if (!belongsToRun(state, action.event.runToken)) return state
      return { ...state, rows: replaceRow(state.rows, action.event.index, { status: "running" }) }
    }

    case "FILE_DONE": {
      const { event } = action
      if (!belongsToRun(state, event.runToken)) return state
      // Un reintento identifica su fila por ruta: su `index` es 0 dentro de la
      // tarea suelta y no se corresponde con la posición en la cola.
      const isRetry = event.runToken.startsWith("retry:")
      const patch: Partial<QueueRow> = {
        status: event.status,
        report: event.report ?? null,
        adjustments: event.adjustments ?? [],
        // Solo se limpia el error cuando hubo un resultado bueno que lo sustituye.
        errorMessage: event.status === "error" ? (event.errorMessage ?? "Error desconocido") : null,
        durationMs: event.durationMs,
      }
      const rows = isRetry
        ? replaceRowByPath(state.rows, event.filePath, patch)
        : replaceRow(state.rows, event.index, patch)
      return { ...state, rows, counters: recount(rows) }
    }

    case "PROGRESS": {
      if (!belongsToRun(state, action.event.runToken)) return state
      if (state.rows.length > 0) return { ...state, counters: recount(state.rows) }
      return { ...state, counters: {
        processed: action.event.processed, pending: action.event.pending,
        ok: action.event.ok, review: action.event.review, error: action.event.error,
      }, concurrency: action.event.concurrency ?? state.concurrency }
    }

    case "RUN_FINISHED": {
      if (!belongsToRun(state, action.event.runToken)) return state
      const rows = state.rows.map((row) => action.event.cancelled && (row.status === "running" || row.status === "pending") ? { ...row, status: "cancelled" as const } : row)
      return {
        ...state,
        rows,
        status: action.event.cancelled ? "cancelled" : "completed",
        counters: recount(rows),
      }
    }

    case "PERSIST_FAILED": {
      if (!belongsToRun(state, action.event.runToken)) return state
      const message = `No se pudieron guardar ${action.event.count} resultado(s): ${action.event.message}`
      if (state.persistErrors.includes(message)) return state
      return { ...state, persistErrors: [...state.persistErrors, message] }
    }

    case "CANCEL_REQUESTED": {
      if (state.status !== "running") return state
      // Las filas ya procesadas se conservan intactas: cancelar no borra
      // resultados. Solo las que no arrancaron pasan a `cancelled`.
      const rows = state.rows.map((row) =>
        row.status === "pending" ? { ...row, status: "cancelled" as const } : row,
      )
      return { ...state, status: "cancelling", rows, counters: recount(rows) }
    }

    case "RETRY_STARTED": {
      return {
        ...state,
        rows: replaceRowByPath(state.rows, action.filePath, { status: "running" }),
      }
    }

    case "EXCLUDE_FILE": {
      // Descartar una fotografía antes de arrancar la saca de esta cola y nada
      // más: el archivo no se toca. Solo aplica a filas que todavía no
      // corrieron, para no borrar un informe ya obtenido.
      if (state.status === "running" || state.status === "cancelling") return state
      const rows = state.rows
        .filter((row) => !(row.filePath === action.filePath && row.status === "pending"))
        // Se reindexa para que `index` siga coincidiendo con la posición que
        // usa Rust al emitir eventos de la próxima corrida.
        .map((row, index) => ({ ...row, index }))
      if (rows.length === state.rows.length) return state
      return { ...state, rows, total: rows.length, counters: recount(rows) }
    }

    case "RESET":
      return EMPTY_QUEUE_STATE
    case "PERSISTED":
      return { ...state, persistErrors: [] }

    default:
      return state
  }
}

/** ETA a partir de la mediana móvil de las filas ya terminadas.
 *  La mediana y no el promedio: una sola foto que tardó 90 s por un reintento
 *  de red desplaza el promedio y le miente al usuario sobre horas de trabajo. */
export function estimateRemainingMs(state: QueueState): number | null {
  const durations = state.rows
    .filter((row) => row.durationMs !== null && row.status === "done")
    .map((row) => row.durationMs as number)
    .sort((a, b) => a - b)
  if (durations.length < 3) return null
  const middle = Math.floor(durations.length / 2)
  const median =
    durations.length % 2 === 0
      ? ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2
      : (durations[middle] ?? 0)
  const remaining = state.counters.pending
  if (remaining <= 0) return 0
  const concurrency = Math.max(state.concurrency, 1)
  return Math.round((median * remaining) / concurrency)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes} min ${seconds.toString().padStart(2, "0")} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${(minutes % 60).toString().padStart(2, "0")} min`
}
