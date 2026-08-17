import type { ConsumptionDropScan } from "../../types"

/**
 * La exploración de caídas de consumo es costosa. Mientras siga abierta la
 * sesión se reutiliza el resultado ya calculado al volver a la vista de alertas,
 * que es lo que antes conseguía mantener el modal montado.
 */
type AlertsScanKey = string
export type AlertsSearchState = {
  key: string
  categoryFilter: "all" | "grandes_clientes" | "fuente_propia" | "operativo"
  filterKind: "all" | "zero" | "extremely_low"
  searchQuery: string
  district: string
  analysisScope: "supply" | "property"
}

const scans = new Map<AlertsScanKey, ConsumptionDropScan>()
const inflight = new Map<AlertsScanKey, Promise<ConsumptionDropScan>>()
const visibleCounts = new Map<AlertsScanKey, number>()
let lastSearch: AlertsSearchState | null = null

export function getCachedScan(key: AlertsScanKey = "all"): ConsumptionDropScan | null {
  return scans.get(key) ?? null
}

export function loadScan(key: AlertsScanKey, fetcher: () => Promise<ConsumptionDropScan>): Promise<ConsumptionDropScan> {
  const cached = scans.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending
  const request = fetcher()
    .then((result) => {
      scans.set(key, result)
      return result
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

export function appendScan(key: AlertsScanKey, result: ConsumptionDropScan): ConsumptionDropScan {
  const current = scans.get(key)
  if (!current) {
    scans.set(key, result)
    return result
  }
  const known = new Set(current.items.map((item) => `${item.supplyCode}-${item.period}`))
  const merged = {
    ...current,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: [...current.items, ...result.items.filter((item) => !known.has(`${item.supplyCode}-${item.period}`))],
  }
  scans.set(key, merged)
  return merged
}

export function getVisibleAlertsCount(key: AlertsScanKey): number {
  return visibleCounts.get(key) ?? 10
}

export function setVisibleAlertsCount(key: AlertsScanKey, count: number): void {
  visibleCounts.set(key, Math.max(10, count))
}

export function invalidateAlertsScan(key: AlertsScanKey): void {
  scans.delete(key)
  inflight.delete(key)
  visibleCounts.delete(key)
}

export function getLastAlertsSearch(): AlertsSearchState | null {
  return lastSearch
}

export function setLastAlertsSearch(search: AlertsSearchState): void {
  lastSearch = search
}

export function clearAlertsCache(): void {
  scans.clear()
  inflight.clear()
  visibleCounts.clear()
  lastSearch = null
}
