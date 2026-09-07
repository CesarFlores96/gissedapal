import { createContext, use, useCallback, useRef, useState, type ReactNode } from "react"
import type { Map as MapLibreMap } from "maplibre-gl"

type MapInteractionValue = {
  mapReady: boolean
  registerMap: (map: MapLibreMap) => void
  unregisterMap: (map: MapLibreMap) => void
  zoomBy: (delta: number) => boolean
}

const MapInteractionContext = createContext<MapInteractionValue | null>(null)

export function MapInteractionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const registerMap = useCallback((map: MapLibreMap): void => {
    mapRef.current = map
    setMapReady(true)
  }, [])

  const unregisterMap = useCallback((map: MapLibreMap): void => {
    if (mapRef.current !== map) return
    mapRef.current = null
    setMapReady(false)
  }, [])

  const zoomBy = useCallback((delta: number): boolean => {
    const map = mapRef.current
    if (!map || !Number.isFinite(delta) || delta === 0) return false
    const currentZoom = map.getZoom()
    const targetZoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), currentZoom + delta))
    if (Math.abs(targetZoom - currentZoom) < 0.0001) return false
    map.zoomTo(targetZoom, { duration: 0, essential: true })
    return true
  }, [])

  const value = { mapReady, registerMap, unregisterMap, zoomBy }
  return <MapInteractionContext value={value}>{children}</MapInteractionContext>
}

// El provider y su hook viven juntos para mantener el contrato del controlador.
// Fast Refresh no puede inferir un límite de componente en un módulo que también
// exporta el hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useMapInteraction(): MapInteractionValue {
  const value = use(MapInteractionContext)
  if (!value) throw new Error("useMapInteraction debe usarse dentro de <MapInteractionProvider>.")
  return value
}
