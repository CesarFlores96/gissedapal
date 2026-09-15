import { createContext, useContext } from "react"
import type { LocalMeterItem, LocalMeterRun, QueueState, ScanSummary } from "./types"

export type MeterQueueContextValue = {
  state: QueueState
  ready: boolean
  busy: boolean
  error: string | null
  scan: ScanSummary | null
  localRuns: LocalMeterRun[]
  localItems: LocalMeterItem[]
  localTotal: number
  loadLocalItems: (page: number, search?: string) => Promise<void>
  chooseFolder: (recursive: boolean) => Promise<void>
  start: () => Promise<void>
  cancel: () => Promise<void>
  resume: (runId: string) => Promise<void>
  retry: (path: string) => Promise<void>
  retryPersistence: () => Promise<void>
  /** Saca una fotografía de esta cola. No toca el archivo en el disco. */
  exclude: (path: string) => void
  /** Vuelve la vista a cero para empezar un análisis nuevo. */
  reset: () => void
}
export const MeterQueueContext = createContext<MeterQueueContextValue | null>(null)
export function useMeterQueue() {
  const value = useContext(MeterQueueContext)
  if (!value) throw new Error("MeterQueueProvider no está disponible")
  return value
}
