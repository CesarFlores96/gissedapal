import { createContext, use } from "react"

import type { CadastralSelection, DistrictOption, GisLayersResponse, LayerKey, LayerMeta } from "../../types"

export type MapViewDataProps = {
  activeLayers: Set<LayerKey>
  cadastralRevision: number
  networkRevision: number
  data: GisLayersResponse | null
  districts: DistrictOption[]
  onBoundsChange: (bbox: [number, number, number, number], zoom: number) => void
  onError: (message: string) => void
  selectedDistrict: DistrictOption | null
  threeDimensional: boolean
}

export type MapDataValue = {
  activeLayers: Set<LayerKey>
  districtOptions: DistrictOption[]
  layerMeta: Partial<Record<LayerKey, LayerMeta>>
  loading: boolean
  mapError: string | null
  searching: boolean
  selectedDistrict: DistrictOption | null
  threeDimensional: boolean
  /** Paquete memoizado de props para `MapView`, que está envuelto en `memo()`. */
  mapViewProps: MapViewDataProps
  addLayers: (layers: LayerKey[]) => void
  applyCorrection: (selection: CadastralSelection, lng: number, lat: number, savedLng: number, savedLat: number) => void
  getViewContext: () => { bbox: [number, number, number, number]; zoom: number } | null
  reloadLastView: () => void
  setMapError: (message: string | null) => void
  setSearching: (value: boolean) => void
  selectDistrict: (district: DistrictOption | null) => void
  toggleLayer: (layer: LayerKey) => void
  toggleThreeDimensional: () => void
}

export const MapDataContext = createContext<MapDataValue | null>(null)

export function useMapData(): MapDataValue {
  const value = use(MapDataContext)
  if (!value) throw new Error("useMapData debe usarse dentro de <MapDataProvider>.")
  return value
}
