import type { BuildingFacade } from "../../types"

/**
 * Caché en memoria `lotId -> facade.json` (Fase 17). Vive fuera de React a
 * propósito: la usan tanto el loader (fetch + dedupe) como el renderer WebGL
 * (que no es un componente React), y no necesita persistir entre sesiones
 * de la app -- un reinicio vuelve a pedir GET, que es barato (ya no llama a
 * Gemma ni a OpenCV, solo lee `gis_building_facades`).
 */
const facades = new Map<string, BuildingFacade>()

export function getCachedFacade(lotId: string): BuildingFacade | undefined {
  return facades.get(lotId)
}

/** Solo reemplaza el valor cacheado si es distinto (version/updatedAt
 * distintos, o no había nada todavía) -- evita invalidar meshes/matrices ya
 * construidos en el renderer por una relectura idéntica. */
export function setCachedFacade(lotId: string, facade: BuildingFacade): boolean {
  const existing = facades.get(lotId)
  if (existing && existing.version === facade.version && existing.updatedAt === facade.updatedAt) {
    return false
  }
  facades.set(lotId, facade)
  return true
}

export function invalidateCachedFacade(lotId: string): void {
  facades.delete(lotId)
}

export function clearFacadeCache(): void {
  facades.clear()
}

export function cachedFacadeCount(): number {
  return facades.size
}
