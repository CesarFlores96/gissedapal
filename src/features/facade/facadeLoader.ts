import { getBuildingFacade, getBuildingFacadeTexture } from "../../lib/ipc"
import type { BuildingFacade } from "../../types"
import { getCachedFacade, invalidateCachedFacade, isKnownMissingFacade, markFacadeMissing, setCachedFacade } from "./facadeStore"

const inFlight = new Map<string, Promise<BuildingFacade | null>>()

/**
 * Carga la fachada de un lote, sirviendo desde caché cuando existe (Fase 7:
 * "SIGUIENTES VISITAS: DB → facade.json → render", ni Gemma ni CV se vuelven
 * a ejecutar). Dedupe de pedidos concurrentes: si el LOD manager pide el
 * mismo lote dos veces en el mismo tick (p. ej. paneo rápido), solo sale un
 * `invoke()`.
 */
export async function loadFacade(lotId: string, options?: { force?: boolean }): Promise<BuildingFacade | null> {
  if (!options?.force) {
    const cached = getCachedFacade(lotId)
    if (cached) return cached
    if (isKnownMissingFacade(lotId)) return null
  }

  const pending = inFlight.get(lotId)
  if (pending && !options?.force) return pending

  const request = getBuildingFacade(lotId)
    .then((facade) => {
      if (facade) setCachedFacade(lotId, facade)
      else markFacadeMissing(lotId)
      return facade
    })
    .finally(() => {
      inFlight.delete(lotId)
    })
  inFlight.set(lotId, request)
  return request
}

const textureRequests = new Map<string, Promise<string | null>>()
const MAX_CACHED_TEXTURES = 48

/** Foto rectificada del frente como data URL, cacheada por `key` (lote +
 * versión): una fachada reanalizada trae otra foto y otra clave. */
export function loadFacadeTexture(lotId: string, key: string): Promise<string | null> {
  const cached = textureRequests.get(key)
  if (cached) return cached
  const request = getBuildingFacadeTexture(lotId).catch((error: unknown) => {
    textureRequests.delete(key)
    throw error
  })
  textureRequests.set(key, request)
  // Cada data URL pesa ~100 KB: se conservan solo las más recientes.
  while (textureRequests.size > MAX_CACHED_TEXTURES) {
    const oldest = textureRequests.keys().next().value
    if (oldest === undefined) break
    textureRequests.delete(oldest)
  }
  return request
}

/** Se llama tras `streetview:facade-ready` (Fase 23: `[FACADE] facade saved`
 * ya se vio en el log de Rust): fuerza a releer de la BD en vez de confiar
 * en una caché que todavía no sabe que hay una versión nueva. */
export async function reloadFacade(lotId: string): Promise<BuildingFacade | null> {
  invalidateCachedFacade(lotId)
  return loadFacade(lotId, { force: true })
}
