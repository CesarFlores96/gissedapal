type Bbox = [number, number, number, number]

// Cota superior de encuadres recordados por distrito: evita que la caché crezca
// sin límite en una sesión de trabajo muy larga.
const MAX_CACHED_SUPPLY_AREAS = 80

/**
 * Encuadres ya descargados, por distrito. Vive en ámbito de módulo y no en un
 * `useRef` porque es una caché pura sin significado por-montaje: así sobrevive a
 * cualquier remontaje del provider (incluido el doble efecto de StrictMode) y se
 * limpia con una llamada directa desde el logout, sin acoplar contextos.
 */
const loadedSupplyAreas = new Map<string, Bbox[]>()

/** Distrito con el que se pobló `mapData`; `undefined` = todavía sin poblar. */
let supplyDataDistrict: string | null | undefined

export function coverageKey(districtName: string | null | undefined): string {
  return districtName ?? "__all_districts__"
}

export function isAreaCovered(key: string, bbox: Bbox, contains: (outer: Bbox, inner: Bbox) => boolean): boolean {
  return (loadedSupplyAreas.get(key) ?? []).some((area) => contains(area, bbox))
}

export function rememberArea(key: string, bbox: Bbox): void {
  const areas = loadedSupplyAreas.get(key) ?? []
  loadedSupplyAreas.set(key, [...areas.slice(-(MAX_CACHED_SUPPLY_AREAS - 1)), bbox])
}

/** Devuelve true si el distrito cambió respecto a la carga anterior. */
export function takeDistrictReset(districtName: string | null): boolean {
  const changed = supplyDataDistrict !== districtName
  supplyDataDistrict = districtName
  return changed
}

export function clearCoverageCache(): void {
  loadedSupplyAreas.clear()
  supplyDataDistrict = undefined
}
