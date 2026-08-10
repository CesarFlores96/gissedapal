import type { CadastralSelection, GisLayersResponse, LayerKey } from "../../types"

export function bboxContains(outer: [number, number, number, number], inner: [number, number, number, number]): boolean {
  const epsilon = 0.000001
  return outer[0] <= inner[0] + epsilon
    && outer[1] <= inner[1] + epsilon
    && outer[2] >= inner[2] - epsilon
    && outer[3] >= inner[3] - epsilon
}

export function translateCoordinates(coordinates: unknown, lng: number, lat: number): unknown {
  if (!Array.isArray(coordinates)) return coordinates
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0] + lng, coordinates[1] + lat, ...coordinates.slice(2)]
  }
  return coordinates.map((child) => translateCoordinates(child, lng, lat))
}

export function applySavedCorrection(
  data: GisLayersResponse | null,
  selected: CadastralSelection,
  lng: number,
  lat: number,
  savedLng: number,
  savedLat: number,
): GisLayersResponse | null {
  if (!data || (!lng && !lat)) return data
  const layers = { ...data.layers }
  for (const key of ["manzanas", "lotes"] as const) {
    const payload = layers[key]
    if (!payload) continue
    layers[key] = {
      ...payload,
      data: {
        ...payload.data,
        features: payload.data.features.map((feature) => {
          const recordId = String(feature.properties?.record_id ?? feature.id ?? "")
          const selectedFeature = ((selected.kind === "block" && key === "manzanas") || (selected.kind === "lot" && key === "lotes")) && recordId === selected.id
          const childLot = selected.kind === "block" && key === "lotes" && feature.properties?.block_code === selected.properties.block_code
          if ((!selectedFeature && !childLot) || !("coordinates" in feature.geometry)) return feature
          return {
            ...feature,
            geometry: { ...feature.geometry, coordinates: translateCoordinates(feature.geometry.coordinates, lng, lat) },
            properties: selectedFeature
              ? { ...feature.properties, correction_lng: savedLng, correction_lat: savedLat }
              : feature.properties,
          } as typeof feature
        }),
      },
    }
  }
  return { ...data, layers }
}

export function mergeResponses(current: GisLayersResponse | null, incoming: GisLayersResponse, reset: boolean): GisLayersResponse {
  if (!current || reset) return incoming
  const layers = { ...current.layers }
  for (const [key, payload] of Object.entries(incoming.layers)) {
    if (!payload) continue
    const layerKey = key as LayerKey
    const previous = layers[layerKey]
    if (!previous || (payload.meta.page ?? 1) === 1) {
      layers[layerKey] = payload
      continue
    }
    const byId = new Map(previous.data.features.map((feature) => [String(feature.id), feature]))
    for (const feature of payload.data.features) byId.set(String(feature.id), feature)
    layers[layerKey] = { ...payload, data: { type: "FeatureCollection", features: [...byId.values()] } }
  }
  return { bbox: incoming.bbox, layers }
}
