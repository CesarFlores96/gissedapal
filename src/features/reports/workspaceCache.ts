import type { ConsumptionFilter } from "./defaultFilter"
import type { ReportsMasterPage } from "../../types"

/**
 * Cache de módulo del último estado del workspace de reportes, separado de
 * `ReportsWorkspace.tsx` para poder vaciarlo desde el logout (`SessionProvider`)
 * sin arrastrar ahí el árbol de componentes pesado (MDI, gráficos) que rompería
 * el code-splitting de la ruta `analisis/reportes`.
 */
export type CachedWorkspaceState = {
  userId: string
  search: string
  appliedSearch: string
  page: number
  sortOrder: "asc" | "desc"
  draftFilter: ConsumptionFilter
  appliedFilter: ConsumptionFilter | null
  data: ReportsMasterPage
  selectedSupply: string | null
}

let cachedWorkspaceState: CachedWorkspaceState | null = null

export function getWorkspaceCache(): CachedWorkspaceState | null {
  return cachedWorkspaceState
}

export function setWorkspaceCache(next: CachedWorkspaceState): void {
  cachedWorkspaceState = next
}

export function clearReportsWorkspaceCache(): void {
  cachedWorkspaceState = null
}
