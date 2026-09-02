import type { Map as MapLibreMap } from "maplibre-gl"

export type MapPerformanceSnapshot = {
  frames: number
  frameP95Ms: number
  longTasks: number
  networkTileLoads: number
  lastTileLoadMs: number | null
}

type PerformanceWindow = Window & { __sedapalGisMapPerformance?: () => MapPerformanceSnapshot }

/**
 * Instrumentación sin estado React para no introducir renders en el hot path.
 * Queda disponible en DevTools mediante `window.__sedapalGisMapPerformance()`.
 */
export function observeMapPerformance(
  map: MapLibreMap,
  areNetworkLayersActive: () => boolean,
): () => void {
  const frameDurations: number[] = []
  let lastFrameAt = performance.now()
  let longTasks = 0
  let networkTileLoads = 0
  let tileStartedAt: number | null = null
  let lastTileLoadMs: number | null = null
  let observer: PerformanceObserver | null = null

  const onRender = (): void => {
    const now = performance.now()
    const duration = now - lastFrameAt
    lastFrameAt = now
    if (!areNetworkLayersActive() || duration > 1_000) return
    frameDurations.push(duration)
    if (frameDurations.length > 240) frameDurations.shift()
  }
  const onDataLoading = (event: { sourceId?: string }): void => {
    if (event.sourceId === "water-pipes-source" || event.sourceId === "water-connections-source") {
      tileStartedAt ??= performance.now()
    }
  }
  const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }): void => {
    if (!event.isSourceLoaded || (event.sourceId !== "water-pipes-source" && event.sourceId !== "water-connections-source")) return
    networkTileLoads += 1
    if (tileStartedAt !== null) lastTileLoadMs = performance.now() - tileStartedAt
    tileStartedAt = null
  }
  map.on("render", onRender)
  map.on("dataloading", onDataLoading)
  map.on("data", onData)
  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((entries) => { longTasks += entries.getEntries().length })
      observer.observe({ type: "longtask", buffered: true })
    } catch {
      observer = null
    }
  }
  ;(window as PerformanceWindow).__sedapalGisMapPerformance = () => {
    const sorted = [...frameDurations].sort((left, right) => left - right)
    const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    return {
      frames: sorted.length,
      frameP95Ms: sorted[index] ?? 0,
      longTasks,
      networkTileLoads,
      lastTileLoadMs,
    }
  }
  return () => {
    map.off("render", onRender)
    map.off("dataloading", onDataLoading)
    map.off("data", onData)
    observer?.disconnect()
    delete (window as PerformanceWindow).__sedapalGisMapPerformance
  }
}
