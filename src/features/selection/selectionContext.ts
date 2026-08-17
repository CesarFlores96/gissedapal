import { createContext, use } from "react"

import type { CadastralSelection, CadastreSearchResult, RelationshipResult, SupplyDetail, SupplyFocusPoint } from "../../types"

export type MapViewSelectionProps = {
  adjustmentDelta: { lng: number; lat: number }
  adjustmentMode: boolean
  focusedSupply: SupplyDetail | null
  focusedSupplyGroup: SupplyFocusPoint[]
  focusedSupplyFocusToken: number
  onAdjustmentDeltaChange: (delta: { lng: number; lat: number }) => void
  onCadastralSelect: (selection: CadastralSelection) => void
  onLocationSelect: (lng: number, lat: number) => void
  onSupplySelect: (supplyCode: string) => void
  selectedCadastral: CadastralSelection | null
  selectionFocusBehavior: "auto" | "preserve"
}

export type SelectionValue = {
  selectedSupply: SupplyDetail | null
  resolvedLocation: RelationshipResult | null
  cadastralSelection: CadastralSelection | null
  inspectorLoading: boolean
  adjustmentMode: boolean
  adjustmentDelta: { lng: number; lat: number }
  adjustmentSaving: boolean
  adjustmentNotice: string | null
  /** Paquete memoizado de props para `MapView`, que está envuelto en `memo()`. */
  mapViewProps: MapViewSelectionProps
  selectSupply: (
    supplyCode: string,
    preview?: Partial<SupplyDetail> | null,
    group?: SupplyFocusPoint[],
  ) => Promise<void>
  searchSupply: (supplyCode: string) => Promise<void>
  searchCadastre: (query: string) => Promise<CadastreSearchResult[]>
  selectCadastreResult: (result: CadastreSearchResult) => void
  viewSupplyCadastre: (link: { code: string | null }) => Promise<void>
  startAdjustment: (target: "selection" | "block") => Promise<void>
  nudgeAdjustment: (eastMeters: number, northMeters: number) => void
  cancelAdjustment: () => void
  persistAdjustment: (reset: boolean) => Promise<void>
  clearSelection: () => void
}

export const SelectionContext = createContext<SelectionValue | null>(null)

export function useSelection(): SelectionValue {
  const value = use(SelectionContext)
  if (!value) throw new Error("useSelection debe usarse dentro de <SelectionProvider>.")
  return value
}
