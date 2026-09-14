import type { BuildingFacade, FacadeElement } from "../../types"
import { extrusionHeightForLevels } from "./buildingHeight"
import { rectifyFacade } from "./facadeRectify"
import { type OpeningKind, type Rect, regularizeFacadeElements } from "./facadeRegularize"

/**
 * Convención de profundidad (Fase 8 del pedido original): la cara frontal
 * del muro es el plano z=0, los huecos quedan recedidos (z negativo, hacia
 * adentro) y lo que sobresale (balcones, losas, cornisa, marcos) va en z
 * positivo. Valores en metros, pensados para una "maqueta" -- no es la
 * profundidad real del predio: el muro es una losa de `depthM` (0.2..1.0 m).
 */
export const FACADE_Z_OFFSETS = {
  wall: 0,
  window: -0.05,
  door: -0.08,
  garageDoor: -0.05,
  balcony: 0.4,
  frame: 0.02,
  floorBand: 0.08,
  cornice: 0.12,
  sill: 0.1,
} as const

export const FACADE_MIN_DEPTH_M = 0.2
export const FACADE_MAX_DEPTH_M = 1.0

const FRAME_WIDTH_M = 0.07
const FLOOR_BAND_HALF_M = 0.09
const CORNICE_HEIGHT_M = 0.18
export const PARAPET_HEIGHT_M = 0.6
const SILL_HEIGHT_M = 0.06
const BAR_WIDTH_M = 0.03
const BAR_SPACING_M = 0.12
const MAX_BARS = 40
const SLAT_SPACING_M = 0.22
const SLAT_HEIGHT_M = 0.04
const RAILING_HEIGHT_M = 0.9
const RAILING_RAIL_M = 0.05

export const FACADE_COLORS = {
  wallFallback: "#c9c2b6",
  glass: "#5f8aa3",
  frame: "#e6e1d8",
  door: "#6b4a35",
  garageDoor: "#7b8086",
  grille: "#2b2f33",
  balcony: "#a9a29b",
} as const

// Tope de huecos: la cara frontal se parte en una grilla por los bordes de
// cada hueco, y los índices son Uint16.
const MAX_OPENINGS = 40

const OPENING_DEPTH: Record<OpeningKind, number> = {
  window: FACADE_Z_OFFSETS.window,
  door: FACADE_Z_OFFSETS.door,
  garageDoor: FACADE_Z_OFFSETS.garageDoor,
}

export type FacadeMesh = {
  /** 3 floats por vértice: x=a lo largo del muro (m), y=altura (m), z=profundidad (m). */
  positions: Float32Array
  /** 4 floats por vértice: r,g,b,a en 0..1. */
  colors: Float32Array
  indices: Uint16Array
  vertexCount: number
}

type Rgb = [number, number, number]
type Point3 = [number, number, number]
type Opening = { kind: OpeningKind; rect: Rect; z: number; element: FacadeElement }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function hexToRgb(hex: string | null | undefined, fallback: string): Rgb {
  const value = (hex && HEX_COLOR.test(hex) ? hex : fallback).slice(1)
  const int = Number.parseInt(value, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

// Sin iluminación en el shader: cada orientación de cara lleva su propio
// tono para que la losa se lea como volumen y no como una mancha plana.
function shade([r, g, b]: Rgb, factor: number): Rgb {
  return [Math.min(1, r * factor), Math.min(1, g * factor), Math.min(1, b * factor)]
}

class MeshBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []

  quad(corners: [Point3, Point3, Point3, Point3], rgb: Rgb): void {
    const base = this.positions.length / 3
    for (const [x, y, z] of corners) {
      this.positions.push(x, y, z)
      this.colors.push(rgb[0], rgb[1], rgb[2], 1)
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  rectAt(rect: Rect, z: number, rgb: Rgb): void {
    this.quad([[rect.x0, rect.y0, z], [rect.x1, rect.y0, z], [rect.x1, rect.y1, z], [rect.x0, rect.y1, z]], rgb)
  }

  /** Paredes laterales de un prisma rectangular entre `zFront` y `zBack`. */
  rectSides(rect: Rect, zFront: number, zBack: number, rgb: Rgb): void {
    const { x0, y0, x1, y1 } = rect
    this.quad([[x0, y1, zFront], [x1, y1, zFront], [x1, y1, zBack], [x0, y1, zBack]], shade(rgb, 0.92))
    this.quad([[x0, y0, zFront], [x1, y0, zFront], [x1, y0, zBack], [x0, y0, zBack]], shade(rgb, 0.6))
    this.quad([[x0, y0, zFront], [x0, y1, zFront], [x0, y1, zBack], [x0, y0, zBack]], shade(rgb, 0.75))
    this.quad([[x1, y0, zFront], [x1, y1, zFront], [x1, y1, zBack], [x1, y0, zBack]], shade(rgb, 0.75))
  }

  /** Prisma sin cara trasera (queda contra el muro): cara frontal + lados. */
  box(rect: Rect, zFront: number, zBack: number, rgb: Rgb): void {
    if (rect.x1 - rect.x0 <= 1e-6 || rect.y1 - rect.y0 <= 1e-6) return
    this.rectAt(rect, zFront, rgb)
    this.rectSides(rect, zFront, zBack, rgb)
  }

  fan(points: [number, number][], z: number, rgb: Rgb): void {
    const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
    const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
    const base = this.positions.length / 3
    this.positions.push(cx, cy, z)
    this.colors.push(rgb[0], rgb[1], rgb[2], 1)
    for (const [x, y] of points) {
      this.positions.push(x, y, z)
      this.colors.push(rgb[0], rgb[1], rgb[2], 1)
    }
    for (let i = 1; i <= points.length; i += 1) {
      this.indices.push(base, base + i, base + (i === points.length ? 1 : i + 1))
    }
  }

  build(): FacadeMesh {
    return {
      positions: new Float32Array(this.positions),
      colors: new Float32Array(this.colors),
      indices: new Uint16Array(this.indices),
      vertexCount: this.positions.length / 3,
    }
  }
}

function sortedUnique(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((value, index) => index === 0 || value - sorted[index - 1] > 1e-6)
}

/** Tramos de [0,width] no cubiertos por los huecos que cruzan la franja
 * vertical [y0,y1] (con margen del marco), para que losas y cornisa no
 * tapen ventanas ni puertas. */
function freeSpans(width: number, y0: number, y1: number, openings: Opening[]): [number, number][] {
  const blocked = openings
    .filter(({ rect }) => rect.y0 - FRAME_WIDTH_M < y1 && rect.y1 + FRAME_WIDTH_M > y0)
    .map(({ rect }) => [Math.max(0, rect.x0 - FRAME_WIDTH_M), Math.min(width, rect.x1 + FRAME_WIDTH_M)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const spans: [number, number][] = []
  let cursor = 0
  for (const [start, end] of blocked) {
    if (start > cursor) spans.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < width) spans.push([cursor, width])
  return spans
}

export function facadeDepthM(facade: BuildingFacade): number {
  return Math.min(FACADE_MAX_DEPTH_M, Math.max(FACADE_MIN_DEPTH_M, facade.dimensions.depthM || 0.5))
}

/** Altura con la que se dibuja: la de la caja del lote cuando se conoce
 * (la fachada va pegada delante de ella), si no la curva aplicada a los
 * pisos de la fachada, y como último recurso `heightM`. */
export function facadeRenderHeightM(facade: BuildingFacade, boxLevels?: number | null): number | null {
  if (typeof boxLevels === "number" && Number.isFinite(boxLevels)) return extrusionHeightForLevels(boxLevels)
  const levels = facade.dimensions.levels
  if (typeof levels === "number" && levels > 0) return extrusionHeightForLevels(levels)
  return facade.dimensions.heightM
}

/** Cantidad de pisos a marcar con losas: la misma que la caja del lote. */
export function facadeFloorCount(facade: BuildingFacade, boxLevels?: number | null): number {
  const levels = typeof boxLevels === "number" && boxLevels > 0 ? boxLevels : facade.dimensions.levels
  return Math.max(1, Math.round(typeof levels === "number" && levels > 0 ? levels : 1))
}

/**
 * Construye la maqueta local (metros, plano de la fachada) desde
 * `facade.json`: losa de muro con espesor que cubre todo el frente desde el
 * suelo, coloreada por piso, con losas marcadas entre pisos, cornisa,
 * parapeto opcional, huecos reales (recedidos, con marco, alféizar, rejas o
 * listones) y balcones salientes. Las posiciones de la foto se rectifican
 * primero (`facadeRectify.ts`). Devuelve `null` cuando faltan ancho o altura
 * -- el llamador deja solo la caja del lote en vez de inventar una escala.
 */
export function buildFacadeMesh(facade: BuildingFacade, options: { boxLevels?: number | null } = {}): FacadeMesh | null {
  const widthM = facade.gis.frontWidthM
  const heightM = facadeRenderHeightM(facade, options.boxLevels)
  if (!widthM || widthM <= 0 || !heightM || heightM <= 0) return null
  const depthM = facadeDepthM(facade)
  const floorCount = facadeFloorCount(facade, options.boxLevels)
  const floorHeightM = heightM / floorCount

  const builder = new MeshBuilder()
  const baseWall = hexToRgb(facade.wall.color, FACADE_COLORS.wallFallback)
  const floorColors = new Map((facade.floors ?? []).map(({ level, color }) => [level, color]))
  const colorAtY = (y: number): Rgb => {
    const level = Math.min(floorCount, Math.max(1, Math.floor(y / floorHeightM) + 1))
    const color = floorColors.get(level)
    return color && HEX_COLOR.test(color) ? hexToRgb(color, FACADE_COLORS.wallFallback) : baseWall
  }
  const rectified = rectifyFacade(facade)

  const regular = regularizeFacadeElements(rectified, widthM, heightM, floorCount)
  const openings: Opening[] = regular.openings
    .slice(0, MAX_OPENINGS)
    .map(({ kind, rect, element }) => ({ kind, rect, element, z: OPENING_DEPTH[kind] }))

  // Cara frontal con huecos: grilla por los bordes de cada hueco y por cada
  // cambio de piso (para poder colorear por piso); se omiten las celdas que
  // caen dentro de un hueco.
  const floorLines = Array.from({ length: floorCount - 1 }, (_, i) => (i + 1) * floorHeightM)
  const xs = sortedUnique([0, widthM, ...openings.flatMap(({ rect }) => [rect.x0, rect.x1])])
  const ys = sortedUnique([0, heightM, ...floorLines, ...openings.flatMap(({ rect }) => [rect.y0, rect.y1])])
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const cell = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] }
      const cx = (cell.x0 + cell.x1) / 2
      const cy = (cell.y0 + cell.y1) / 2
      if (openings.some(({ rect }) => cx > rect.x0 && cx < rect.x1 && cy > rect.y0 && cy < rect.y1)) continue
      builder.rectAt(cell, FACADE_Z_OFFSETS.wall, colorAtY(cy))
    }
  }

  // Espesor de la losa: cara trasera + un lado por arista.
  const outline: [number, number][] = [[0, 0], [widthM, 0], [widthM, heightM], [0, heightM]]
  builder.fan(outline, -depthM, shade(baseWall, 0.55))
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    const horizontal = Math.abs(by - ay) < Math.abs(bx - ax)
    const color = colorAtY(Math.min(ay, by) + (horizontal ? 0 : floorHeightM / 2))
    builder.quad([[ax, ay, 0], [bx, by, 0], [bx, by, -depthM], [ax, ay, -depthM]], shade(color, horizontal ? 0.9 : 0.72))
  }

  // Losas entre pisos y cornisa: se leen los pisos aunque Gemma no haya
  // marcado ventanas.
  for (const lineY of floorLines) {
    const y0 = lineY - FLOOR_BAND_HALF_M
    const y1 = lineY + FLOOR_BAND_HALF_M
    for (const [x0, x1] of freeSpans(widthM, y0, y1, openings)) {
      builder.box({ x0, y0, x1, y1 }, FACADE_Z_OFFSETS.floorBand, 0, shade(colorAtY(lineY - FLOOR_BAND_HALF_M), 0.82))
    }
  }
  const corniceY0 = Math.max(0, heightM - CORNICE_HEIGHT_M)
  for (const [x0, x1] of freeSpans(widthM, corniceY0, heightM, openings)) {
    builder.box({ x0, y0: corniceY0, x1, y1: heightM }, FACADE_Z_OFFSETS.cornice, 0, shade(colorAtY(heightM - 0.01), 0.85))
  }
  if (facade.roof?.parapet) {
    const parapet = { x0: 0, y0: heightM, x1: widthM, y1: heightM + PARAPET_HEIGHT_M }
    const color = colorAtY(heightM - 0.01)
    builder.box(parapet, FACADE_Z_OFFSETS.wall, -depthM, color)
  }

  for (const { kind, rect, z, element } of openings) {
    const floorColor = colorAtY((rect.y0 + rect.y1) / 2)
    const elementColor = element.color_hex && HEX_COLOR.test(element.color_hex) ? element.color_hex : null
    const leaf = kind === "window"
      ? hexToRgb(FACADE_COLORS.glass, FACADE_COLORS.glass)
      : hexToRgb(elementColor, kind === "door" ? FACADE_COLORS.door : FACADE_COLORS.garageDoor)
    const frame = kind === "window"
      ? hexToRgb(elementColor, FACADE_COLORS.frame)
      : shade(leaf, 0.72)

    // Fondo recedido + jambas: se lee como abertura, no como sticker.
    builder.rectAt(rect, z, leaf)
    builder.rectSides(rect, FACADE_Z_OFFSETS.wall, z, shade(floorColor, 0.8))

    // Marco saliente (puertas y portones sin travesaño inferior: llegan al piso).
    const f = FRAME_WIDTH_M
    const frameZ = FACADE_Z_OFFSETS.frame
    builder.box({ x0: rect.x0 - f, y0: rect.y1, x1: rect.x1 + f, y1: rect.y1 + f }, frameZ, 0, frame)
    builder.box({ x0: rect.x0 - f, y0: rect.y0, x1: rect.x0, y1: rect.y1 }, frameZ, 0, frame)
    builder.box({ x0: rect.x1, y0: rect.y0, x1: rect.x1 + f, y1: rect.y1 }, frameZ, 0, frame)
    if (kind === "window") {
      builder.box({ x0: rect.x0 - f, y0: rect.y0 - f, x1: rect.x1 + f, y1: rect.y0 }, frameZ, 0, frame)
      if (rect.y0 - f - SILL_HEIGHT_M > 0) {
        builder.box(
          { x0: rect.x0 - 2 * f, y0: rect.y0 - f - SILL_HEIGHT_M, x1: rect.x1 + 2 * f, y1: rect.y0 - f },
          FACADE_Z_OFFSETS.sill, 0, shade(frame, 0.9),
        )
      }
    }

    const width = rect.x1 - rect.x0
    const height = rect.y1 - rect.y0
    if (element.reja) {
      const bars = Math.min(MAX_BARS, Math.max(1, Math.floor(width / BAR_SPACING_M)))
      const grille = elementColor ? shade(hexToRgb(elementColor, FACADE_COLORS.grille), 0.75) : hexToRgb(FACADE_COLORS.grille, FACADE_COLORS.grille)
      const barZ = z + 0.03
      for (let b = 1; b <= bars; b += 1) {
        const cx = rect.x0 + (width * b) / (bars + 1)
        builder.rectAt({ x0: cx - BAR_WIDTH_M / 2, y0: rect.y0, x1: cx + BAR_WIDTH_M / 2, y1: rect.y1 }, barZ, grille)
      }
      for (const t of [1 / 3, 2 / 3]) {
        const cy = rect.y0 + height * t
        builder.rectAt({ x0: rect.x0, y0: cy - BAR_WIDTH_M / 2, x1: rect.x1, y1: cy + BAR_WIDTH_M / 2 }, barZ, grille)
      }
    } else if (kind === "garageDoor") {
      const slat = shade(leaf, 0.8)
      for (let y = rect.y0 + SLAT_SPACING_M; y + SLAT_HEIGHT_M < rect.y1; y += SLAT_SPACING_M) {
        builder.rectAt({ x0: rect.x0, y0: y, x1: rect.x1, y1: y + SLAT_HEIGHT_M }, z + 0.01, slat)
      }
    } else if (kind === "window" && width > 0.9) {
      // Parteluz: una ventana ancha se lee como ventana y no como un vano.
      const cx = (rect.x0 + rect.x1) / 2
      builder.rectAt({ x0: cx - f / 2, y0: rect.y0, x1: cx + f / 2, y1: rect.y1 }, z + 0.02, frame)
    }
  }

  // Balcón: losa saliente al nivel del piso + baranda de barrotes.
  const balconyColor = hexToRgb(FACADE_COLORS.balcony, FACADE_COLORS.balcony)
  const depth = FACADE_Z_OFFSETS.balcony
  for (const { rect, element } of regular.balconies) {
    builder.box(rect, depth, FACADE_Z_OFFSETS.wall, balconyColor)
    const railColor = element.color_hex && HEX_COLOR.test(element.color_hex)
      ? hexToRgb(element.color_hex, FACADE_COLORS.grille)
      : hexToRgb(FACADE_COLORS.grille, FACADE_COLORS.grille)
    const top = rect.y1 + RAILING_HEIGHT_M
    const railZ = depth - 0.02
    builder.box({ x0: rect.x0, y0: top - RAILING_RAIL_M, x1: rect.x1, y1: top }, railZ, railZ - 0.05, railColor)
    const width = rect.x1 - rect.x0
    const bars = Math.min(MAX_BARS, Math.max(2, Math.floor(width / BAR_SPACING_M)))
    for (let b = 0; b <= bars; b += 1) {
      const cx = rect.x0 + (width * b) / bars
      builder.rectAt({ x0: cx - BAR_WIDTH_M / 2, y0: rect.y1, x1: cx + BAR_WIDTH_M / 2, y1: top }, railZ, railColor)
    }
  }

  const mesh = builder.build()
  return mesh.vertexCount > 0 && mesh.vertexCount <= 65535 ? mesh : null
}
