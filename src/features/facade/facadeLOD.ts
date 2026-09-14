/**
 * Reglas de Level Of Detail para la fachada procedural 2.5D (Fase 10 del
 * pedido original). Puro y sin dependencias de MapLibre: solo decide QUÉ
 * lotes merecen intentar renderizar su fachada detallada dado el zoom y
 * cuántos candidatos hay -- el renderer (`FacadeLayer.ts`) es quien
 * finalmente dibuja o cae a `fill-extrusion`.
 */

/** Por debajo de este zoom no tiene sentido evaluar fachadas: a esa escala
 * ni siquiera se distinguen ventanas individuales en pantalla. */
export const FACADE_MIN_ZOOM = 17

/** Techo duro de fachadas detalladas simultáneas, sin importar cuántos
 * lotes esten en pantalla -- evita construir/dibujar cientos de mallas por
 * frame en una cuadra densa. */
export const MAX_DETAILED_FACADES = 60

export type FacadeCandidate = {
  lotId: string
  /** Distancia al centro del viewport, en cualquier unidad consistente
   * (píxeles de pantalla o metros): solo importa el orden relativo. */
  distanceToCenter: number
}

/**
 * `true` si a este zoom vale la pena intentar fachada procedural para un
 * lote. El lote seleccionado es una excepción deliberada (Fase 10:
 * "predio seleccionado: prioridad para cargar fachada") -- si el usuario ya
 * seleccionó el predio y su fachada existe, no tiene sentido ocultarla solo
 * por haber alejado un poco el zoom.
 */
export function shouldAttemptFacade(zoom: number, isSelected: boolean): boolean {
  return isSelected || zoom >= FACADE_MIN_ZOOM
}

/**
 * De todos los lotes candidatos (visibles + con facade.json disponible),
 * elige cuáles renderizar en detalle, respetando `MAX_DETAILED_FACADES`.
 * Prioridad: 1) lote seleccionado, 2) más cercano al centro del viewport.
 * "Visible" y "distancia a cámara" se combinan en un solo criterio de
 * distancia en V1 (ver docs/FACADE_2_5D.md) -- separarlos en pasos
 * independientes no aporta con los volúmenes actuales de lotes por cuadra.
 */
export function selectFacadeCandidates(
  candidates: FacadeCandidate[],
  selectedLotId: string | null,
  maxCount: number = MAX_DETAILED_FACADES,
): string[] {
  const sorted = [...candidates].sort((a, b) => {
    const aSelected = a.lotId === selectedLotId
    const bSelected = b.lotId === selectedLotId
    if (aSelected !== bSelected) return aSelected ? -1 : 1
    return a.distanceToCenter - b.distanceToCenter
  })
  return sorted.slice(0, Math.max(0, maxCount)).map((candidate) => candidate.lotId)
}
