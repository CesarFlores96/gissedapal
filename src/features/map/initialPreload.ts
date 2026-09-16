import type { GisLayersResponse, LayerKey } from "../../types"

// Mismas capas que `MapDataProvider` activa por defecto: "distritos" sostiene el
// enfoque de cámara y el atenuado del resto del mapa.
export const INITIAL_LAYERS: LayerKey[] = ["distritos", "manzanas", "lotes", "suministros"]

// Envolvente generosa de Lima + Callao: no intenta igualar el bbox exacto que
// va a pedir MapLibre (depende del tamaño real de ventana/sidebar), sólo le da
// a MapDataProvider un adelanto de datos para no arrancar en blanco. El fetch
// real del viewport llega igual apenas el mapa reporta sus bounds y reemplaza
// esta página 1 (ver mergeResponses en features/map/geometry.ts).
export const INITIAL_BBOX: [number, number, number, number] = [-77.4, -12.7, -76.5, -11.4]
export const INITIAL_ZOOM = 10.4

let preloadedResponse: GisLayersResponse | null = null

export function setInitialLayersPreload(response: GisLayersResponse): void {
  preloadedResponse = response
}

/** Se consume una sola vez: sólo el primer montaje de MapDataProvider por sesión debe usarlo. */
export function takeInitialLayersPreload(): GisLayersResponse | null {
  const value = preloadedResponse
  preloadedResponse = null
  return value
}
