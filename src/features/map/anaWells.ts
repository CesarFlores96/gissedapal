import type { FeatureCollection, Point } from "geojson"

/** GeoJSON de ANA filtrado a Lima y Callao, incluido en el paquete de escritorio. */
export const ANA_WELLS_TOTAL = 8_082
export const ANA_WELLS_URL = `${import.meta.env.BASE_URL}data/pozos/ana_pozos.geojson`

export type AnaWellProperties = {
  CODIGO?: string
  DISTRITO?: string
  ESTADO?: string
  PROPIETARI?: string
  TIPO?: string
  USOS?: string
}

export type AnaWellsCollection = FeatureCollection<Point, AnaWellProperties>

let cachedWells: AnaWellsCollection | null = null
let pendingWells: Promise<AnaWellsCollection> | null = null

function isAnaWellsCollection(value: unknown): value is AnaWellsCollection {
  if (!value || typeof value !== "object") return false
  const candidate = value as { type?: unknown; features?: unknown }
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features)
    && candidate.features.every((feature) => (
      feature
      && typeof feature === "object"
      && (feature as { geometry?: { type?: unknown } }).geometry?.type === "Point"
    ))
}

/** Carga una sola vez el archivo estático; cambiar de visibilidad no vuelve a descargarlo. */
export function getAnaWells(): Promise<AnaWellsCollection> {
  if (cachedWells) return Promise.resolve(cachedWells)
  if (!pendingWells) {
    pendingWells = fetch(ANA_WELLS_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la capa de pozos ANA.")
        const payload: unknown = await response.json()
        if (!isAnaWellsCollection(payload)) throw new Error("La capa de pozos ANA no tiene el formato esperado.")
        cachedWells = payload
        return payload
      })
      .catch((error: unknown) => {
        pendingWells = null
        throw error
      })
  }
  return pendingWells
}
