import type { BuildingFacade, FacadeElement } from "../../types"

/**
 * Convención de profundidad (Fase 8 del pedido original): la cara frontal
 * del muro es el plano z=0, los huecos quedan recedidos (z negativo, hacia
 * adentro) y los balcones sobresalen hacia la calle (z positivo). Valores
 * en metros, pensados para una "maqueta" -- no es la profundidad real del
 * predio: el muro es una losa de `depthM` (0.2..1.0 m) detrás de z=0.
 */
export const FACADE_Z_OFFSETS = {
  wall: 0,
  window: -0.05,
  door: -0.08,
  garageDoor: -0.05,
  balcony: 0.4,
} as const

export const FACADE_MIN_DEPTH_M = 0.2
export const FACADE_MAX_DEPTH_M = 1.0

export const FACADE_COLORS = {
  wallFallback: "#c9c2b6",
  window: "#4f7f99",
  door: "#5b4636",
  garageDoor: "#4a4a4a",
  balcony: "#a9a29b",
} as const

// Tope de huecos: la cara frontal se parte en una grilla por los bordes de
// cada hueco, y los índices son Uint16.
const MAX_OPENINGS = 40

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
type Rect = { x0: number; y0: number; x1: number; y1: number }

function hexToRgb(hex: string | null | undefined, fallback: string): Rgb {
  const value = (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback).slice(1)
  const int = Number.parseInt(value, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

// Sin iluminación en el shader: cada orientación de cara lleva su propio
// tono para que la losa se lea como volumen y no como una mancha plana.
function shade([r, g, b]: Rgb, factor: number): Rgb {
  return [r * factor, g * factor, b * factor]
}

class MeshBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []

  quad(corners: [Point3, Point3, Point3, Point3], rgb: Rgb, alpha: number): void {
    const base = this.positions.length / 3
    for (const [x, y, z] of corners) {
      this.positions.push(x, y, z)
      this.colors.push(rgb[0], rgb[1], rgb[2], alpha)
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  rectAt(rect: Rect, z: number, rgb: Rgb, alpha: number): void {
    this.quad([[rect.x0, rect.y0, z], [rect.x1, rect.y0, z], [rect.x1, rect.y1, z], [rect.x0, rect.y1, z]], rgb, alpha)
  }

  /** Paredes laterales de un prisma rectangular entre `zFront` y `zBack`. */
  rectSides(rect: Rect, zFront: number, zBack: number, rgb: Rgb): void {
    const { x0, y0, x1, y1 } = rect
    this.quad([[x0, y1, zFront], [x1, y1, zFront], [x1, y1, zBack], [x0, y1, zBack]], shade(rgb, 0.92), 1)
    this.quad([[x0, y0, zFront], [x1, y0, zFront], [x1, y0, zBack], [x0, y0, zBack]], shade(rgb, 0.6), 1)
    this.quad([[x0, y0, zFront], [x0, y1, zFront], [x0, y1, zBack], [x0, y0, zBack]], shade(rgb, 0.75), 1)
    this.quad([[x1, y0, zFront], [x1, y1, zFront], [x1, y1, zBack], [x1, y0, zBack]], shade(rgb, 0.75), 1)
  }

  /** Fan desde el centroide: correcto para los contornos simples que pide el
   * prompt de Gemma (rectángulos o 1-2 escalones en la línea de techo). */
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

function elementRect(element: FacadeElement, widthM: number, heightM: number): Rect | null {
  if (!(element.width > 0) || !(element.height > 0)) return null
  const x0 = Math.max(0, Math.min(1, element.x)) * widthM
  const x1 = Math.max(0, Math.min(1, element.x + element.width)) * widthM
  // La imagen fuente tiene y=0 arriba; el espacio local tiene y=0 en el suelo.
  const y0 = (1 - Math.min(1, element.y + element.height)) * heightM
  const y1 = (1 - Math.max(0, element.y)) * heightM
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function sortedUnique(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((value, index) => index === 0 || value - sorted[index - 1] > 1e-6)
}

/**
 * Construye la maqueta local (metros, plano de la fachada) desde
 * `facade.json`: losa de muro con espesor, huecos reales para ventanas y
 * puertas (recedidos, visibles a través de la cara frontal) y balcones como
 * cajas salientes. Devuelve `null` cuando faltan ancho o altura reales -- el
 * llamador cae al `fill-extrusion` en vez de inventar una escala.
 */
export function buildFacadeMesh(facade: BuildingFacade): FacadeMesh | null {
  const widthM = facade.gis.frontWidthM
  const heightM = facade.dimensions.heightM
  if (!widthM || widthM <= 0 || !heightM || heightM <= 0) return null
  const depthM = Math.min(FACADE_MAX_DEPTH_M, Math.max(FACADE_MIN_DEPTH_M, facade.dimensions.depthM || 0.5))

  const builder = new MeshBuilder()
  const wallColor = hexToRgb(facade.wall.color, FACADE_COLORS.wallFallback)

  const rawOutline = facade.outline.length >= 3 ? facade.outline : [[0, 1], [0, 0], [1, 0], [1, 1]]
  const outline: [number, number][] = rawOutline.map(([x, y]) => [
    Math.max(0, Math.min(1, x)) * widthM,
    (1 - Math.max(0, Math.min(1, y))) * heightM,
  ])

  const openings: { rect: Rect; z: number; rgb: Rgb; alpha: number }[] = []
  const collect = (elements: FacadeElement[], z: number, hex: string, alpha: number) => {
    for (const element of elements) {
      if (openings.length >= MAX_OPENINGS) return
      const rect = elementRect(element, widthM, heightM)
      if (rect) openings.push({ rect, z, rgb: hexToRgb(hex, hex), alpha })
    }
  }
  collect(facade.doors, FACADE_Z_OFFSETS.door, FACADE_COLORS.door, 1)
  collect(facade.garageDoors, FACADE_Z_OFFSETS.garageDoor, FACADE_COLORS.garageDoor, 1)
  collect(facade.windows, FACADE_Z_OFFSETS.window, FACADE_COLORS.window, 1)

  // Cara frontal con huecos: grilla por los bordes de cada hueco y de cada
  // vértice del contorno; cada celda se emite si su centro cae dentro del
  // contorno y fuera de todo hueco.
  const xs = sortedUnique([0, widthM, ...outline.map(([x]) => x), ...openings.flatMap(({ rect }) => [rect.x0, rect.x1])])
  const ys = sortedUnique([0, heightM, ...outline.map(([, y]) => y), ...openings.flatMap(({ rect }) => [rect.y0, rect.y1])])
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const cell = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] }
      const cx = (cell.x0 + cell.x1) / 2
      const cy = (cell.y0 + cell.y1) / 2
      if (!pointInPolygon(cx, cy, outline)) continue
      if (openings.some(({ rect }) => cx > rect.x0 && cx < rect.x1 && cy > rect.y0 && cy < rect.y1)) continue
      builder.rectAt(cell, FACADE_Z_OFFSETS.wall, wallColor, 1)
    }
  }

  // Espesor de la losa: cara trasera + un lado por arista del contorno.
  builder.fan(outline, -depthM, shade(wallColor, 0.55))
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    const horizontal = Math.abs(by - ay) < Math.abs(bx - ax)
    builder.quad([[ax, ay, 0], [bx, by, 0], [bx, by, -depthM], [ax, ay, -depthM]], shade(wallColor, horizontal ? 0.9 : 0.72), 1)
  }

  // Huecos: fondo recedido + jambas, así se leen como aberturas y no como
  // stickers pegados al muro.
  for (const { rect, z, rgb, alpha } of openings) {
    builder.rectAt(rect, z, rgb, alpha)
    builder.rectSides(rect, FACADE_Z_OFFSETS.wall, z, shade(wallColor, 0.85))
  }

  const balconyColor = hexToRgb(FACADE_COLORS.balcony, FACADE_COLORS.balcony)
  for (const element of facade.balconies) {
    const rect = elementRect(element, widthM, heightM)
    if (!rect) continue
    builder.rectAt(rect, FACADE_Z_OFFSETS.balcony, balconyColor, 1)
    builder.rectSides(rect, FACADE_Z_OFFSETS.balcony, FACADE_Z_OFFSETS.wall, balconyColor)
  }

  const mesh = builder.build()
  return mesh.vertexCount > 0 && mesh.vertexCount <= 65535 ? mesh : null
}
