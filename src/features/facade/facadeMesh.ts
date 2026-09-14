import type { BuildingFacade, FacadeElement } from "../../types"
import { extrusionHeightForLevels } from "./buildingHeight"
import { rectifyFacade, type RectifiedRoofTank } from "./facadeRectify"
import { type OpeningKind, type Rect, regularizeFacadeElements } from "./facadeRegularize"

/**
 * Convención de profundidad (Fase 8 del pedido original): la cara frontal
 * del muro es el plano z=0, los huecos quedan recedidos (z negativo, hacia
 * adentro) y lo que sobresale (balcones, losas, cornisa, marcos) va en z
 * positivo. Valores en metros, pensados para una "maqueta" -- no es la
 * profundidad real del predio: el muro es una losa de `depthM` (0.2..1.0 m).
 * Lo que está detrás de la losa (z < -depthM) cae sobre la azotea de la caja
 * del lote: ahí van los tanques.
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
/** Holgura entre la cara trasera de la losa y la cara frontal de la caja del lote. */
export const FACADE_BOX_GAP_M = 0.03

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

// Azotea (valores típicos de Lima).
const TANK_BASE_HEIGHT_M = 0.35
const PLASTIC_TANK_HEIGHT_M = 1.25
const PLASTIC_TANK_MIN_RADIUS_M = 0.5
const PLASTIC_TANK_MAX_RADIUS_M = 0.85
const CONCRETE_TANK_SIDE_M = 1.6
const CONCRETE_TANK_HEIGHT_M = 1.3
const TANK_SETBACK_M = 0.9
const TANK_SEGMENTS = 14
const REBAR_SPACING_M = 3.5
const REBAR_STUB_SIDE_M = 0.25
const REBAR_STUB_HEIGHT_M = 0.18
const REBAR_BAR_M = 0.025
const REBAR_HEIGHT_M = 0.85

export const FACADE_COLORS = {
  wallFallback: "#c9c2b6",
  glass: "#5f8aa3",
  frame: "#e6e1d8",
  door: "#6b4a35",
  garageDoor: "#7b8086",
  grille: "#2b2f33",
  balcony: "#a9a29b",
  plasticTank: "#1f2326",
  concrete: "#9c9a94",
  rebar: "#7a4a2c",
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
  /** 3 floats por vértice: normal de la cara en el mismo espacio local. */
  normals: Float32Array
  /** 3 floats por vértice: u, v de la foto y cuánto pesa la foto (0 = color). */
  uvs: Float32Array
  indices: Uint16Array
  vertexCount: number
}

type Rgb = [number, number, number]
type Vec3 = [number, number, number]
type Point3 = [number, number, number]
type Uv = [number, number]
type Opening = { kind: OpeningKind; rect: Rect; z: number; element: FacadeElement }

const FRONT: Vec3 = [0, 0, 1]
const BACK: Vec3 = [0, 0, -1]
const UP: Vec3 = [0, 1, 0]
const DOWN: Vec3 = [0, -1, 0]
const LEFT: Vec3 = [-1, 0, 0]
const RIGHT: Vec3 = [1, 0, 0]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function hexToRgb(hex: string | null | undefined, fallback: string): Rgb {
  const value = (hex && HEX_COLOR.test(hex) ? hex : fallback).slice(1)
  const int = Number.parseInt(value, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

function shade([r, g, b]: Rgb, factor: number): Rgb {
  return [Math.min(1, r * factor), Math.min(1, g * factor), Math.min(1, b * factor)]
}

class MeshBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly indices: number[] = []

  private vertex([x, y, z]: Point3, rgb: Rgb, normal: Vec3, uv: Uv | null): void {
    this.positions.push(x, y, z)
    this.colors.push(rgb[0], rgb[1], rgb[2], 1)
    this.normals.push(normal[0], normal[1], normal[2])
    if (uv) this.uvs.push(uv[0], uv[1], 1)
    else this.uvs.push(0, 0, 0)
  }

  quad(corners: [Point3, Point3, Point3, Point3], rgb: Rgb, normal: Vec3, uvs: [Uv, Uv, Uv, Uv] | null = null): void {
    const base = this.positions.length / 3
    corners.forEach((corner, i) => this.vertex(corner, rgb, normal, uvs ? uvs[i] : null))
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** Rectángulo en el plano z; con `photo` lleva las coordenadas de la foto
   * rectificada (u a lo ancho del frente, v desde el techo). */
  rectAt(rect: Rect, z: number, rgb: Rgb, normal: Vec3 = FRONT, photo: { widthM: number; heightM: number } | null = null): void {
    const corners: [Point3, Point3, Point3, Point3] = [[rect.x0, rect.y0, z], [rect.x1, rect.y0, z], [rect.x1, rect.y1, z], [rect.x0, rect.y1, z]]
    const uv = (x: number, y: number): Uv => [x / photo!.widthM, 1 - y / photo!.heightM]
    const uvs: [Uv, Uv, Uv, Uv] | null = photo
      ? [uv(rect.x0, rect.y0), uv(rect.x1, rect.y0), uv(rect.x1, rect.y1), uv(rect.x0, rect.y1)]
      : null
    this.quad(corners, rgb, normal, uvs)
  }

  /** Paredes laterales de un prisma entre `zFront` y `zBack`. `inward`: las
   * jambas de un hueco miran hacia adentro del hueco, no hacia afuera. */
  rectSides(rect: Rect, zFront: number, zBack: number, rgb: Rgb, inward = false): void {
    const { x0, y0, x1, y1 } = rect
    const flip = (n: Vec3): Vec3 => (inward ? [-n[0], -n[1], -n[2]] : n)
    this.quad([[x0, y1, zFront], [x1, y1, zFront], [x1, y1, zBack], [x0, y1, zBack]], rgb, flip(UP))
    this.quad([[x0, y0, zFront], [x1, y0, zFront], [x1, y0, zBack], [x0, y0, zBack]], rgb, flip(DOWN))
    this.quad([[x0, y0, zFront], [x0, y1, zFront], [x0, y1, zBack], [x0, y0, zBack]], rgb, flip(LEFT))
    this.quad([[x1, y0, zFront], [x1, y1, zFront], [x1, y1, zBack], [x1, y0, zBack]], rgb, flip(RIGHT))
  }

  /** Prisma sin cara trasera (queda contra el muro): cara frontal + lados. */
  box(rect: Rect, zFront: number, zBack: number, rgb: Rgb): void {
    if (rect.x1 - rect.x0 <= 1e-6 || rect.y1 - rect.y0 <= 1e-6) return
    this.rectAt(rect, zFront, rgb, zFront >= zBack ? FRONT : BACK)
    this.rectSides(rect, zFront, zBack, rgb)
  }

  /** Prisma cerrado (se ve desde cualquier lado): fierros, bases, tanques de concreto. */
  solid(rect: Rect, zFront: number, zBack: number, rgb: Rgb): void {
    this.box(rect, zFront, zBack, rgb)
    this.rectAt(rect, zBack, rgb, BACK)
  }

  /** Cilindro vertical con tapa, apoyado en `baseY`. */
  cylinder(cx: number, cz: number, baseY: number, radius: number, height: number, rgb: Rgb): void {
    const topY = baseY + height
    for (let i = 0; i < TANK_SEGMENTS; i += 1) {
      const a0 = (i / TANK_SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / TANK_SEGMENTS) * Math.PI * 2
      const mid = (a0 + a1) / 2
      const p = (a: number, y: number): Point3 => [cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]
      this.quad([p(a0, baseY), p(a1, baseY), p(a1, topY), p(a0, topY)], rgb, [Math.cos(mid), 0, Math.sin(mid)])
    }
    const lid = shade(rgb, 0.85)
    const base = this.positions.length / 3
    this.vertex([cx, topY, cz], lid, UP, null)
    for (let i = 0; i <= TANK_SEGMENTS; i += 1) {
      const a = (i / TANK_SEGMENTS) * Math.PI * 2
      this.vertex([cx + Math.cos(a) * radius, topY, cz + Math.sin(a) * radius], lid, UP, null)
    }
    for (let i = 1; i <= TANK_SEGMENTS; i += 1) this.indices.push(base, base + i, base + i + 1)
  }

  fan(points: [number, number][], z: number, rgb: Rgb, normal: Vec3): void {
    const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
    const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
    const base = this.positions.length / 3
    this.vertex([cx, cy, z], rgb, normal, null)
    for (const [x, y] of points) this.vertex([x, y, z], rgb, normal, null)
    for (let i = 1; i <= points.length; i += 1) {
      this.indices.push(base, base + i, base + (i === points.length ? 1 : i + 1))
    }
  }

  build(): FacadeMesh {
    return {
      positions: new Float32Array(this.positions),
      colors: new Float32Array(this.colors),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
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

/** Posiciones de columnas a lo largo del frente: esquinas + cada ~3.5 m. */
export function rebarColumnPositions(widthM: number): number[] {
  const inset = REBAR_STUB_SIDE_M
  if (widthM <= inset * 4) return [widthM / 2]
  const spans = Math.max(1, Math.round((widthM - 2 * inset) / REBAR_SPACING_M))
  return Array.from({ length: spans + 1 }, (_, i) => inset + ((widthM - 2 * inset) * i) / spans)
}

function addRoof(
  builder: MeshBuilder,
  tanks: RectifiedRoofTank[],
  rebar: boolean,
  widthM: number,
  heightM: number,
  depthM: number,
  roofTopY: number,
): void {
  const concrete = hexToRgb(FACADE_COLORS.concrete, FACADE_COLORS.concrete)
  // Detrás de la losa, sobre la azotea de la caja del lote.
  const roofZ = -(depthM + FACADE_BOX_GAP_M + TANK_SETBACK_M)
  for (const tank of tanks) {
    const cx = Math.max(0.8, Math.min(widthM - 0.8, tank.u * widthM))
    if (tank.kind === "concreto") {
      const half = CONCRETE_TANK_SIDE_M / 2
      const cz = roofZ - half
      builder.solid({ x0: cx - half, y0: heightM, x1: cx + half, y1: heightM + CONCRETE_TANK_HEIGHT_M }, cz + half, cz - half, hexToRgb(tank.color, FACADE_COLORS.concrete))
      continue
    }
    const radius = Math.min(PLASTIC_TANK_MAX_RADIUS_M, Math.max(PLASTIC_TANK_MIN_RADIUS_M, (tank.width * widthM) / 2))
    const cz = roofZ - radius
    builder.solid(
      { x0: cx - radius - 0.1, y0: heightM, x1: cx + radius + 0.1, y1: heightM + TANK_BASE_HEIGHT_M },
      cz + radius + 0.1, cz - radius - 0.1, concrete,
    )
    const fallback = tank.kind === "metalico" ? "#a7adb3" : FACADE_COLORS.plasticTank
    builder.cylinder(cx, cz, heightM + TANK_BASE_HEIGHT_M, radius, PLASTIC_TANK_HEIGHT_M, hexToRgb(tank.color, fallback))
  }

  if (!rebar) return
  const steel = hexToRgb(FACADE_COLORS.rebar, FACADE_COLORS.rebar)
  const cz = -depthM / 2
  for (const cx of rebarColumnPositions(widthM)) {
    const half = REBAR_STUB_SIDE_M / 2
    builder.solid({ x0: cx - half, y0: roofTopY, x1: cx + half, y1: roofTopY + REBAR_STUB_HEIGHT_M }, cz + half, cz - half, concrete)
    const barBase = roofTopY + REBAR_STUB_HEIGHT_M
    for (const dx of [-0.07, 0.07]) {
      for (const dz of [-0.07, 0.07]) {
        const bx = cx + dx
        const bz = cz + dz
        const b = REBAR_BAR_M / 2
        builder.solid({ x0: bx - b, y0: barBase, x1: bx + b, y1: barBase + REBAR_HEIGHT_M }, bz + b, bz - b, steel)
      }
    }
  }
}

/**
 * Construye la maqueta local (metros, plano de la fachada) desde
 * `facade.json`. Dos modos:
 *
 * - `textured`: la cara frontal lleva la foto de Street View rectificada; no
 *   se agregan huecos, marcos ni losas porque la foto ya los muestra y
 *   ponerlos encima (con posiciones aproximadas) los duplicaría corridos.
 * - procedural (sin foto): color por piso, losas entre pisos, cornisa,
 *   parapeto, huecos recedidos con marco/alféizar/reja/listones y balcones.
 *
 * En ambos: espesor de la losa, tanques elevados y fierros en la azotea, y
 * normales por cara para la iluminación del shader. Devuelve `null` cuando
 * faltan ancho o altura -- el llamador deja solo la caja del lote.
 */
export function buildFacadeMesh(
  facade: BuildingFacade,
  options: { boxLevels?: number | null; textured?: boolean } = {},
): FacadeMesh | null {
  const widthM = facade.gis.frontWidthM
  const heightM = facadeRenderHeightM(facade, options.boxLevels)
  if (!widthM || widthM <= 0 || !heightM || heightM <= 0) return null
  const depthM = facadeDepthM(facade)
  const floorCount = facadeFloorCount(facade, options.boxLevels)
  const floorHeightM = heightM / floorCount
  const textured = options.textured === true

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
  const openings: Opening[] = textured
    ? []
    : regular.openings.slice(0, MAX_OPENINGS).map(({ kind, rect, element }) => ({ kind, rect, element, z: OPENING_DEPTH[kind] }))

  // Cara frontal: con foto, un solo rectángulo texturizado; sin foto, grilla
  // por bordes de huecos y cambios de piso (color por piso), sin las celdas
  // que caen dentro de un hueco.
  const floorLines = Array.from({ length: floorCount - 1 }, (_, i) => (i + 1) * floorHeightM)
  if (textured) {
    builder.rectAt({ x0: 0, y0: 0, x1: widthM, y1: heightM }, FACADE_Z_OFFSETS.wall, baseWall, FRONT, { widthM, heightM })
  } else {
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
  }

  // Espesor de la losa: cara trasera + un lado por arista.
  const outline: [number, number][] = [[0, 0], [widthM, 0], [widthM, heightM], [0, heightM]]
  builder.fan(outline, -depthM, shade(baseWall, 0.8), BACK)
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    const length = Math.hypot(bx - ax, by - ay) || 1
    const normal: Vec3 = [(by - ay) / length, -(bx - ax) / length, 0]
    const color = textured ? baseWall : colorAtY(Math.min(ay, by) + (Math.abs(by - ay) > 0 ? floorHeightM / 2 : 0))
    builder.quad([[ax, ay, 0], [bx, by, 0], [bx, by, -depthM], [ax, ay, -depthM]], color, normal)
  }

  let roofTopY = heightM
  if (!textured) {
    // Losas entre pisos y cornisa: se leen los pisos aunque Gemma no haya
    // marcado ventanas.
    for (const lineY of floorLines) {
      const y0 = lineY - FLOOR_BAND_HALF_M
      const y1 = lineY + FLOOR_BAND_HALF_M
      for (const [x0, x1] of freeSpans(widthM, y0, y1, openings)) {
        builder.box({ x0, y0, x1, y1 }, FACADE_Z_OFFSETS.floorBand, 0, shade(colorAtY(lineY - FLOOR_BAND_HALF_M), 0.9))
      }
    }
    const corniceY0 = Math.max(0, heightM - CORNICE_HEIGHT_M)
    for (const [x0, x1] of freeSpans(widthM, corniceY0, heightM, openings)) {
      builder.box({ x0, y0: corniceY0, x1, y1: heightM }, FACADE_Z_OFFSETS.cornice, 0, shade(colorAtY(heightM - 0.01), 0.92))
    }
    if (facade.roof?.parapet) {
      builder.box({ x0: 0, y0: heightM, x1: widthM, y1: heightM + PARAPET_HEIGHT_M }, FACADE_Z_OFFSETS.wall, -depthM, colorAtY(heightM - 0.01))
      roofTopY = heightM + PARAPET_HEIGHT_M
    }
  }

  for (const { kind, rect, z, element } of openings) {
    const floorColor = colorAtY((rect.y0 + rect.y1) / 2)
    const elementColor = element.color_hex && HEX_COLOR.test(element.color_hex) ? element.color_hex : null
    const leaf = kind === "window"
      ? hexToRgb(FACADE_COLORS.glass, FACADE_COLORS.glass)
      : hexToRgb(elementColor, kind === "door" ? FACADE_COLORS.door : FACADE_COLORS.garageDoor)
    const frame = kind === "window" ? hexToRgb(elementColor, FACADE_COLORS.frame) : shade(leaf, 0.72)

    // Fondo recedido + jambas: se lee como abertura, no como sticker.
    builder.rectAt(rect, z, leaf)
    builder.rectSides(rect, FACADE_Z_OFFSETS.wall, z, shade(floorColor, 0.85), true)

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
          FACADE_Z_OFFSETS.sill, 0, shade(frame, 0.95),
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

  if (!textured) {
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
  }

  addRoof(builder, rectified.roofTanks, facade.roof?.rebar === true, widthM, heightM, depthM, roofTopY)

  const mesh = builder.build()
  return mesh.vertexCount > 0 && mesh.vertexCount <= 65535 ? mesh : null
}
