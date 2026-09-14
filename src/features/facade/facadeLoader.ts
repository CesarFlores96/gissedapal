import { getBuildingFacade } from "../../lib/ipc"
import type { BuildingFacade } from "../../types"
import { getCachedFacade, invalidateCachedFacade, setCachedFacade } from "./facadeStore"

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
  }

  const pending = inFlight.get(lotId)
  if (pending && !options?.force) return pending

  const request = getBuildingFacade(lotId)
    .then((facade) => {
      if (facade) setCachedFacade(lotId, facade)
      return facade
    })
    .finally(() => {
      inFlight.delete(lotId)
    })
  inFlight.set(lotId, request)
  return request
}

/** Se llama tras `streetview:facade-ready` (Fase 23: `[FACADE] facade saved`
 * ya se vio en el log de Rust): fuerza a releer de la BD en vez de confiar
 * en una caché que todavía no sabe que hay una versión nueva. */
export async function reloadFacade(lotId: string): Promise<BuildingFacade | null> {
  invalidateCachedFacade(lotId)
  return loadFacade(lotId, { force: true })
}
