import { useEffect, useReducer, useRef, useState, type ReactNode } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { meterApi, meterError } from "./api"
import { MeterQueueContext } from "./queueContext"
import { EMPTY_QUEUE_STATE, queueReducer, type QueueAction } from "./queueState"
import type { ScanResult } from "./types"

export function MeterQueueProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(queueReducer, EMPTY_QUEUE_STATE)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const recursive = useRef(false)
  const operation = useRef(false)
  // Lo descartado por el operador. Se guarda acá y no se deriva de las filas
  // para poder mandar solo esto, en vez de la carpeta entera.
  const excluded = useRef<Set<string>>(new Set())

  useEffect(() => {
    let disposed = false
    const listeners: UnlistenFn[] = []
    const events = [
      ["run-started", "RUN_STARTED"], ["file-started", "FILE_STARTED"],
      ["file-done", "FILE_DONE"], ["progress", "PROGRESS"],
      ["run-finished", "RUN_FINISHED"], ["persist-failed", "PERSIST_FAILED"],
    ] as const
    void Promise.all(events.map(async ([name, type]) => {
      const unlisten = await listen(`meter-analysis:${name}`, ({ payload }) => {
        if (!disposed) dispatch({ type, event: payload } as QueueAction)
      })
      if (disposed) unlisten()
      else listeners.push(unlisten)
    })).then(() => { if (!disposed) setReady(true) })
      .catch((err: unknown) => { if (!disposed) setError(meterError(err)) })
    return () => { disposed = true; listeners.forEach((stop) => stop()); void meterApi.cancel().catch(() => undefined) }
  }, [])

  async function act(work: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    try { await work() } catch (err) { setError(meterError(err)) }
    finally { operation.current = false; setBusy(false) }
  }

  return <MeterQueueContext.Provider value={{ state, ready, busy, error, scan,
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
      // Se envían solo las fotografías que quedaron en la lista: el operador
      // pudo descartar algunas. Rust igual valida contra su propio escaneo.
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
    retry: (path) => act(async () => {
      if (!state.runId) return
      // El error de la fila se conserva hasta obtener el resultado del reintento.
      await meterApi.retry(state.runId, path)
    }),
  }}>{children}</MeterQueueContext.Provider>
}
