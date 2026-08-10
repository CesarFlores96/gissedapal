import type { ConsumptionDropScan } from "../../types"

/**
 * La exploración de caídas de consumo es costosa. Mientras siga abierta la
 * sesión se reutiliza el resultado ya calculado al volver a la vista de alertas,
 * que es lo que antes conseguía mantener el modal montado.
 */
let scan: ConsumptionDropScan | null = null
let inflight: Promise<ConsumptionDropScan> | null = null

export function getCachedScan(): ConsumptionDropScan | null {
  return scan
}

export function loadScan(fetcher: () => Promise<ConsumptionDropScan>): Promise<ConsumptionDropScan> {
  if (scan) return Promise.resolve(scan)
  if (inflight) return inflight
  inflight = fetcher()
    .then((result) => {
      scan = result
      return result
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function clearAlertsCache(): void {
  scan = null
  inflight = null
}
