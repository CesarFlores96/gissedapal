import type { SupplyDetail } from "../../types"

/**
 * Cachés de suministro en ámbito de módulo. `pendingRequests` guarda promesas en
 * vuelo, así que perderla en un remontaje duplicaría llamadas IPC: por eso no
 * son `useRef`. Se vacían desde el logout con `clearSupplyCaches()`.
 */
const detailCache = new Map<string, SupplyDetail>()
const pendingRequests = new Map<string, Promise<SupplyDetail>>()
const consumptionCache = new Map<string, SupplyDetail["consumption"]>()

export function getCachedDetail(code: string): SupplyDetail | undefined {
  return detailCache.get(code)
}

export function getPendingDetail(code: string): Promise<SupplyDetail> | undefined {
  return pendingRequests.get(code)
}

export function trackDetailRequest(code: string, request: Promise<SupplyDetail>): void {
  pendingRequests.set(code, request)
}

export function cacheDetail(code: string, detail: SupplyDetail): void {
  detailCache.set(code, detail)
}

export function forgetPendingDetail(code: string): void {
  pendingRequests.delete(code)
}

export function getCachedConsumption(code: string): SupplyDetail["consumption"] | undefined {
  return consumptionCache.get(code)
}

export function cacheConsumption(code: string, consumption: SupplyDetail["consumption"]): void {
  consumptionCache.set(code, consumption)
}

export function clearSupplyCaches(): void {
  detailCache.clear()
  pendingRequests.clear()
  consumptionCache.clear()
}
