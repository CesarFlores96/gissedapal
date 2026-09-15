import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { meterApi, meterError } from "./api"
import { MeterQueueContext } from "./queueContext"
import { EMPTY_QUEUE_STATE, queueReducer, type QueueAction } from "./queueState"
import type { LocalMeterItem, LocalMeterRun, ScanSummary } from "./types"

export function MeterQueueProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(queueReducer, EMPTY_QUEUE_STATE)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanSummary | null>(null)
  const [localRuns, setLocalRuns] = useState<LocalMeterRun[]>([])
  const [localItems, setLocalItems] = useState<LocalMeterItem[]>([])
  const [localTotal, setLocalTotal] = useState(0)
  const recursive = useRef(false)
  const operation = useRef(false)
  // Lo descartado por el operador. Se guarda acá y no se deriva de las filas
  // para poder mandar solo esto, en vez de la carpeta entera.
  const excluded = useRef<Set<string>>(new Set())

  const refreshLocalRuns = useCallback(async () => {
    setLocalRuns(await meterApi.localRuns())
  }, [])

  const refreshLocalItems = useCallback(async (runId: string, page: number, search?: string) => {
    const response = await meterApi.localItems(runId, page, search)
    setLocalItems(response.data)
    setLocalTotal(response.total)
    setLocalRuns(await meterApi.localRuns())
  }, [])

  const loadLocalItems = useCallback(async (page: number, search?: string) => {
    if (state.runId) await refreshLocalItems(state.runId, page, search)
  }, [refreshLocalItems, state.runId])

  useEffect(() => {
    let disposed = false
    const listeners: UnlistenFn[] = []
    const events = [
      ["run-started", "RUN_STARTED"], ["progress", "PROGRESS"],
      ["run-finished", "RUN_FINISHED"], ["persist-failed", "PERSIST_FAILED"],
    ] as const
    void Promise.all(events.map(async ([name, type]) => {
      const unlisten = await listen(`meter-analysis:${name}`, ({ payload }) => {
        if (disposed) return
        dispatch({ type, event: payload } as QueueAction)
        const runId = typeof payload === "object" && payload !== null && "runId" in payload && typeof payload.runId === "string" ? payload.runId : null
        if (runId) void refreshLocalItems(runId, 1)
      })
      if (disposed) unlisten()
      else listeners.push(unlisten)
    })).then(async () => { if (!disposed) { setReady(true); setLocalRuns(await meterApi.localRuns()) } })
      .catch((err: unknown) => { if (!disposed) setError(meterError(err)) })
    return () => { disposed = true; listeners.forEach((stop) => stop()); void meterApi.pause().catch(() => undefined) }
  }, [refreshLocalItems])

  async function act(work: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    try { await work() } catch (err) { setError(meterError(err)) }
    finally { operation.current = false; setBusy(false) }
  }

  return <MeterQueueContext.Provider value={{ state, ready, busy, error, scan, localRuns, localItems, localTotal,
    loadLocalItems,
    retryPersistence: () => act(async () => { await meterApi.retryPersistence(); dispatch({ type: "PERSISTED" }) }),
    chooseFolder: (includeSubfolders) => act(async () => {
      const folder = await meterApi.pickFolder()
      if (!folder) return
      const selected = await meterApi.scan(folder, includeSubfolders)
      recursive.current = includeSubfolders
      excluded.current = new Set()
      setScan(selected)
      dispatch({ type: "SCANNED", scan: selected })
    }),
    start: () => act(async () => {
      if (!scan) return
      // El manifiesto y las huellas se conservan en SQLite; el webview recibe
      // solo el resumen, no una lista masiva de rutas.
      await meterApi.start(scan.folder, recursive.current, [...excluded.current])
    }),
    exclude: (path) => { excluded.current.add(path); dispatch({ type: "EXCLUDE_FILE", filePath: path }) },
    reset: () => {
      // Empezar de cero: se limpia la cola y el escaneo, sin tocar el disco.
      excluded.current = new Set()
      setScan(null)
      setError(null)
      dispatch({ type: "RESET" })
    },
    cancel: async () => {
      try { await meterApi.cancel(); dispatch({ type: "CANCEL_REQUESTED" }) }
      catch (err) { setError(meterError(err)) }
    },
    resume: (runId) => act(async () => {
      if (!scan) throw new Error("Selecciona nuevamente la carpeta original antes de reanudar.")
      await meterApi.resume(runId, scan.folder)
      await refreshLocalRuns()
    }),
    retry: (path) => act(async () => {
      if (!state.runId) return
      // El error de la fila se conserva hasta obtener el resultado del reintento.
      await meterApi.retry(state.runId, path)
    }),
  }}>{children}</MeterQueueContext.Provider>
}
