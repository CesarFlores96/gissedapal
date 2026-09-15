import { invoke } from "@tauri-apps/api/core"

export type LotContext = {
  lot: {
    id: string
    lotCode: string
    blockId: string
  }
  currentHolders: Array<{
    legalEntityId: string
    legalName: string
    entityType: string
    relationshipType: string
    validFrom: string
    validTo: string | null
  }>
  supplies: Array<{
    id: string
    supplyCode: string
    serviceStatus: string
    connection: {
      id: string
      assetCode: string
      status: string
    } | null
    meters: Array<{
      id: string
      serialNumber: string
      status: string
    }>
  }>
}

export function getTileServerUrl(durationHours?: number): Promise<string> {
  return invoke("get_tile_server_url", durationHours ? { durationHours } : {})
}

export function getLotContext(lotId: string): Promise<LotContext> {
  return invoke("get_lot_context", { lotId })
}

/** IDs de los lotes medianeros (pegados) al lote dado -- para resaltar junto
 * con el predio seleccionado toda la fila de casas contiguas. */
export async function getLotNeighbors(lotId: string): Promise<string[]> {
  const result = await invoke<{ neighborIds?: unknown }>("get_lot_neighbors", { lotId })
  return Array.isArray(result?.neighborIds) ? result.neighborIds.filter((id): id is string => typeof id === "string") : []
}
