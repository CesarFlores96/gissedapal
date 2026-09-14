import type { BuildingFacade } from "../../types"

/**
 * Caché en memoria `lotId -> facade.json` (Fase 17). Vive fuera de React a
 * propósito: la usan tanto el loader (fetch + dedupe) como el renderer WebGL
 * (que no es un componente React), y no necesita persistir entre sesiones
 * de la app -- un reinicio vuelve a pedir GET, que es barato (ya no llama a
 * Gemma ni a OpenCV, solo lee `gis_building_facades`).
 */
const facades = new Map<string, BuildingFacade>()

/** Lotes que respondieron "sin fachada" (404) y cuándo. Sin esto, cada
 * `moveend` volvía a pedir ~60 GET que casi todos dan 404 y la ráfaga agotaba
 * el rate limit del backend (1200/min por usuario): el siguiente pedido de
 * config de Ollama recibía 429 y el análisis caía en un 401 engañoso. */
const missing = new Map<string, number>()

export const MISSING_FACADE_TTL_MS = 10 * 60 * 1000

export function getCachedFacade(lotId: string): BuildingFacade | undefined {
  return facades.get(lotId)
}

export function isKnownMissingFacade(lotId: string, now: number = Date.now()): boolean {
  const markedAt = missing.get(lotId)
  if (markedAt === undefined) return false
  if (now - markedAt < MISSING_FACADE_TTL_MS) return true
  missing.delete(lotId)
  return false
}

export function markFacadeMissing(lotId: string, now: number = Date.now()): void {
  missing.set(lotId, now)
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
  missing.delete(lotId)
  return true
}

export function invalidateCachedFacade(lotId: string): void {
  facades.delete(lotId)
  missing.delete(lotId)
}

export function clearFacadeCache(): void {
  facades.clear()
  missing.clear()
}

export function cachedFacadeCount(): number {
  return facades.size
}
