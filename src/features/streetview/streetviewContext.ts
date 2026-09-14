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
  persisted?: boolean
  persistError?: string | null
  /** Lote catastral activo (`record_id`), si Street View se abrió desde uno. */
  lotId: string | null
}

/** Payload de `streetview:facade-ready` (ver `analyze_facade` en
 * `streetview.rs`): la fachada 2.5D de ese lote ya se guardó en
 * `gis_building_facades`, hay que releerla (no confiar en caché vieja). */
export type FacadeReadySignal = {
  lotId: string
  version: number
}

export type MapViewStreetviewProps = {
  streetviewPosition: StreetviewPosition | null
  streetviewFloorAnalysis: FloorAnalysis | null
  /** true mientras Ollama está procesando la captura más reciente. */
  streetviewAnalyzing: boolean
  /** Cambia de referencia cada vez que llega un `streetview:facade-ready`
   * nuevo (incluso para el mismo lote): MapView lo usa como trigger de
   * efecto, no como el único dato a leer. */
  streetviewFacadeReady: FacadeReadySignal | null
}

export type StreetviewValue = {
  position: StreetviewPosition | null
  floorAnalysis: FloorAnalysis | null
  analyzing: boolean
  facadeReady: FacadeReadySignal | null
  /** Paquete memoizado de props para `MapView`, que está envuelto en `memo()`. */
  mapViewProps: MapViewStreetviewProps
}

export const StreetviewContext = createContext<StreetviewValue | null>(null)

export function useStreetview(): StreetviewValue {
  const value = use(StreetviewContext)
  if (!value) throw new Error("useStreetview debe usarse dentro de <StreetviewProvider>.")
  return value
}
