import type { FacadeElement } from "../../types"
import type { RectifiedFacade } from "./facadeRectify"

export type Rect = { x0: number; y0: number; x1: number; y1: number }
export type OpeningKind = "window" | "door" | "garageDoor"
export type PlacedOpening = { kind: OpeningKind; rect: Rect; floor: number; element: FacadeElement }
export type PlacedBalcony = { rect: Rect; floor: number; element: FacadeElement }

// Proporciones de arquitectura típica (fracción de la altura del piso).
const WINDOW_SILL = 0.3
const WINDOW_HEAD = 0.8
const PICTURE_WINDOW_SILL = 0.1
const DOOR_HEAD = 0.73
const GARAGE_HEAD = 0.8
/** Recuadro de Gemma más alto que esto (fracción del piso) = ventanal/vitrina. */
const PICTURE_WINDOW_MIN_HEIGHT = 0.65

const MIN_WINDOW_WIDTH_M = 0.45
const MIN_WINDOW_HEIGHT_M = 0.3
/** Ancho/alto por debajo de esto es un tubo, poste o cable, no una ventana. */
const MIN_WINDOW_ASPECT = 0.22
const MIN_DOOR_WIDTH_M = 0.8
const MIN_GARAGE_WIDTH_M = 1.8
const MIN_BALCONY_WIDTH_M = 1
const SIDE_MARGIN_M = 0.12
const TOP_MARGIN_M = 0.25
/** Solapamiento (sobre el menor de los dos) a partir del cual es un duplicado. */
const MAX_OVERLAP = 0.3
const BALCONY_SLAB_M = 0.15

function toMeters(element: FacadeElement, widthM: number, heightM: number): Rect | null {
  if (!(element.width > 0) || !(element.height > 0)) return null
  const x0 = Math.max(0, Math.min(1, element.x)) * widthM
  const x1 = Math.max(0, Math.min(1, element.x + element.width)) * widthM
  // Imagen: y=0 arriba. Fachada: y=0 en el suelo.
  const y0 = (1 - Math.min(1, element.y + element.height)) * heightM
  const y1 = (1 - Math.max(0, element.y)) * heightM
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

function floorOf(element: FacadeElement, rect: Rect, floorHeightM: number, floorCount: number): number {
  const declared = element.piso ?? element.floor
  if (typeof declared === "number" && Number.isInteger(declared) && declared >= 1 && declared <= floorCount) return declared
  const centerY = (rect.y0 + rect.y1) / 2
  return Math.min(floorCount, Math.max(1, Math.floor(centerY / floorHeightM) + 1))
}

function widenTo(rect: Rect, minWidth: number, widthM: number): Rect {
  let { x0, x1 } = rect
  if (x1 - x0 < minWidth) {
    const cx = (x0 + x1) / 2
    x0 = cx - minWidth / 2
    x1 = cx + minWidth / 2
  }
  const shift = Math.max(0, SIDE_MARGIN_M - x0) - Math.max(0, x1 - (widthM - SIDE_MARGIN_M))
  x0 = Math.max(SIDE_MARGIN_M, x0 + shift)
  x1 = Math.min(widthM - SIDE_MARGIN_M, x1 + shift)
  return { ...rect, x0, x1 }
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
  return (w * h) / smaller
}

/**
 * Convierte los recuadros de Gemma (ya rectificados, 0..1) en huecos con
 * proporciones de arquitectura: cada ventana se alinea a antepecho/dintel de
 * su piso (así todas las de un mismo piso quedan a la misma altura), puertas y
 * portones se apoyan en el piso, se descartan piezas imposibles (tubos,
 * cables, recuadros diminutos) y duplicados, y los balcones se ubican como
 * losa al nivel del piso. Gemma decide QUÉ hay y más o menos DÓNDE en
 * horizontal; la altura exacta la pone la regla, porque ahí los recuadros de
 * Gemma son lo menos confiable.
 */
export function regularizeFacadeElements(
  rectified: RectifiedFacade,
  widthM: number,
  heightM: number,
  floorCount: number,
): { openings: PlacedOpening[]; balconies: PlacedBalcony[] } {
  const floorHeightM = heightM / floorCount
  const base = (floor: number) => (floor - 1) * floorHeightM
  const maxY = heightM - TOP_MARGIN_M
  const kept: PlacedOpening[] = []

  const accept = (candidate: PlacedOpening) => {
    const { rect } = candidate
    if (rect.x1 - rect.x0 <= 0.05 || rect.y1 - rect.y0 <= 0.05) return
    if (kept.some((other) => overlapRatio(other.rect, rect) > MAX_OVERLAP)) return
    kept.push(candidate)
  }

  const byWidthDesc = (elements: FacadeElement[]) => elements
    .map((element) => ({ element, rect: toMeters(element, widthM, heightM) }))
    .filter((item): item is { element: FacadeElement; rect: Rect } => item.rect !== null)
    .sort((a, b) => (b.rect.x1 - b.rect.x0) - (a.rect.x1 - a.rect.x0))

  // Portones y puertas primero: son los elementos más grandes y definen la planta baja.
  for (const { element, rect } of byWidthDesc(rectified.garageDoors)) {
    const floor = floorOf(element, rect, floorHeightM, floorCount)
    const narrow = rect.x1 - rect.x0 < MIN_GARAGE_WIDTH_M * 0.6
    const kind: OpeningKind = narrow ? "door" : "garageDoor"
    const widened = widenTo(rect, narrow ? MIN_DOOR_WIDTH_M : MIN_GARAGE_WIDTH_M, widthM)
    const head = Math.min(maxY, base(floor) + floorHeightM * (narrow ? DOOR_HEAD : GARAGE_HEAD))
    accept({ kind, floor, element, rect: { ...widened, y0: base(floor), y1: head } })
  }
  for (const { element, rect } of byWidthDesc(rectified.doors)) {
    const floor = floorOf(element, rect, floorHeightM, floorCount)
    const widened = widenTo(rect, MIN_DOOR_WIDTH_M, widthM)
    const head = Math.min(maxY, base(floor) + floorHeightM * DOOR_HEAD)
    accept({ kind: "door", floor, element, rect: { ...widened, y0: base(floor), y1: head } })
  }
  for (const { element, rect } of byWidthDesc(rectified.windows)) {
    const width = rect.x1 - rect.x0
    const height = rect.y1 - rect.y0
    if (width < MIN_WINDOW_WIDTH_M || height < MIN_WINDOW_HEIGHT_M || width / height < MIN_WINDOW_ASPECT) continue
    const floor = floorOf(element, rect, floorHeightM, floorCount)
    const picture = height > floorHeightM * PICTURE_WINDOW_MIN_HEIGHT
    const y0 = base(floor) + floorHeightM * (picture ? PICTURE_WINDOW_SILL : WINDOW_SILL)
    const y1 = Math.min(maxY, base(floor) + floorHeightM * WINDOW_HEAD)
    accept({ kind: "window", floor, element, rect: { ...widenTo(rect, MIN_WINDOW_WIDTH_M, widthM), y0, y1 } })
  }

  const balconies: PlacedBalcony[] = []
  for (const { element, rect } of byWidthDesc(rectified.balconies)) {
    const floor = floorOf(element, rect, floorHeightM, floorCount)
    // En planta baja no hay balcón: suele ser un toldo o la vereda mal leída.
    if (floor < 2) continue
    const widened = widenTo(rect, MIN_BALCONY_WIDTH_M, widthM)
    const slab = { ...widened, y0: base(floor) - BALCONY_SLAB_M / 2, y1: base(floor) + BALCONY_SLAB_M / 2 }
    if (balconies.some((other) => other.floor === floor && overlapRatio(other.rect, slab) > MAX_OVERLAP)) continue
    balconies.push({ rect: slab, floor, element })
  }

  return { openings: kept, balconies }
}
