import type { Feature, FeatureCollection, Geometry } from "geojson"

type CadastralProperties = Record<string, unknown>
type CadastralFeature = Feature<Geometry, CadastralProperties>
type CadastralCollection = FeatureCollection<Geometry, CadastralProperties>

const dedupeCache = new WeakMap<CadastralCollection, CadastralCollection>()

function numericProperty(feature: CadastralFeature, key: string): number {
  const value = feature.properties?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function sourcePriority(feature: CadastralFeature): number {
  const source = feature.properties?.source
  if (source === "SEDAPAL_ARCGIS_CATASTRO_COMERCIAL") return 2
  if (source === "SEDAPAL_ARCGIS_DERIVED_FROM_LOTS") return 1
  return 0
}

function shouldReplace(current: CadastralFeature, candidate: CadastralFeature): boolean {
  const currentLots = numericProperty(current, "lot_count")
  const candidateLots = numericProperty(candidate, "lot_count")
  if (candidateLots !== currentLots) return candidateLots > currentLots

  const currentSource = sourcePriority(current)
  const candidateSource = sourcePriority(candidate)
  if (candidateSource !== currentSource) return candidateSource > currentSource

  const currentId = String(current.properties?.record_id ?? current.id ?? "")
  const candidateId = String(candidate.properties?.record_id ?? candidate.id ?? "")
  return candidateId.localeCompare(currentId) < 0
}

/**
 * Evita dibujar dos veces una manzana con la misma geometría dentro del mismo
 * distrito. No elimina registros de la base: conserva para interacción el que
 * tiene más lotes vinculados y usa la fuente comercial como segundo criterio.
 */
export function dedupeExactBlockGeometries(collection: CadastralCollection): CadastralCollection {
  const cached = dedupeCache.get(collection)
  if (cached) return cached

  const selected = new Map<string, CadastralFeature>()
  for (const feature of collection.features) {
    const district = String(feature.properties?.district_code ?? feature.properties?.district ?? "")
    const key = `${district}:${JSON.stringify(feature.geometry)}`
    const current = selected.get(key)
    if (!current || shouldReplace(current, feature)) selected.set(key, feature)
  }

  const result = selected.size === collection.features.length
    ? collection
    : { ...collection, features: [...selected.values()] }
  dedupeCache.set(collection, result)
  return result
}
