import { createContext, use } from "react"

export type StreetviewPosition = {
  lat: number
  lng: number
  heading: number | null
  pitch: number | null
}

export type FloorAnalysis = {
  lat: number
  lng: number
  heading: number | null
  floors: number | null
  confidence: string | null
  colorHex: string | null
  note: string | null
  error: string | null
  /** Lote catastral activo (`record_id`), si Street View se abrió desde uno. */
  lotId: string | null
}

export type MapViewStreetviewProps = {
  streetviewPosition: StreetviewPosition | null
  streetviewFloorAnalysis: FloorAnalysis | null
  /** true mientras Ollama está procesando la captura más reciente. */
  streetviewAnalyzing: boolean
}

export type StreetviewValue = {
  position: StreetviewPosition | null
  floorAnalysis: FloorAnalysis | null
  analyzing: boolean
  /** Paquete memoizado de props para `MapView`, que está envuelto en `memo()`. */
  mapViewProps: MapViewStreetviewProps
}

export const StreetviewContext = createContext<StreetviewValue | null>(null)

export function useStreetview(): StreetviewValue {
  const value = use(StreetviewContext)
  if (!value) throw new Error("useStreetview debe usarse dentro de <StreetviewProvider>.")
  return value
}
