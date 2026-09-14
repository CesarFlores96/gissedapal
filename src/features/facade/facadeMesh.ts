import type { BuildingFacade, FacadeElement } from "../../types"

/**
 * Convención de profundidad (Fase 8 del pedido original): la pared es el
 * plano z=0, los huecos quedan recedidos (z negativo, hacia adentro del
 * muro) y los balcones sobresalen hacia la calle (z positivo). Valores en
 * metros, pensados para una "maqueta" -- no son la profundidad real del
 * predio (ver `depthM` en facade.json, que solo acota el espesor visual
 * máximo del renderer).
 */
export const FACADE_Z_OFFSETS = {
  wall: 0,
  window: -0.05,
  door: -0.08,
  garageDoor: -0.05,
  balcony: 0.4,
} as const

export const FACADE_COLORS = {
  wallFallback: "#c9c2b6",
  window: "#7fa8bd",
  door: "#5b4636",
  garageDoor: "#4a4a4a",
  balcony: "#a9a29b",
} as const

export type FacadeMesh = {
  /** 3 floats por vértice: x=a lo largo del muro (m), y=altura (m), z=profundidad (m). */
  positions: Float32Array
  /** 4 floats por vértice: r,g,b,a en 0..1. */
  colors: Float32Array
  indices: Uint16Array
  vertexCount: number
}

function hexToRgb(hex: string | null | undefined, fallback: string): [number, number, number] {
  const value = (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback).slice(1)
  const int = Number.parseInt(value, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

class MeshBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []

  addQuad(
    x0: number, y0: number, x1: number, y1: number, z: number,
    rgb: [number, number, number], alpha: number,
  ): void {
    const base = this.positions.length / 3
    const [r, g, b] = rgb
    const corners: [number, number][] = [
      [x0, y0], [x1, y0], [x1, y1], [x0, y1],
    ]
    for (const [x, y] of corners) {
      this.positions.push(x, y, z)
      this.colors.push(r, g, b, alpha)
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** Fan de triángulos desde el centroide -- correcto para el tipo de
   * contornos simples (rectangulares o con 1-2 escalones en la línea de
   * techo) que pide el prompt de Gemma; un contorno cóncavo "en estrella"
   * respecto de su propio centroide podría triangular mal, caso que se deja
   * para V2 (ver docs/FACADE_2_5D.md). */
  addOutlineFan(points: [number, number][], z: number, rgb: [number, number, number], alpha: number): void {
    if (points.length < 3) return
    const centroid: [number, number] = points
      .reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0])
      .map((sum) => sum / points.length) as [number, number]
    const [r, g, b] = rgb
    const base = this.positions.length / 3
    this.positions.push(centroid[0], centroid[1], z)
    this.colors.push(r, g, b, alpha)
    for (const [x, y] of points) {
      this.positions.push(x, y, z)
      this.colors.push(r, g, b, alpha)
    }
    for (let i = 1; i <= points.length; i += 1) {
      const next = i === points.length ? 1 : i + 1
      this.indices.push(base, base + i, base + next)
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

function elementRect(element: FacadeElement, widthM: number, heightM: number) {
  const x0 = Math.max(0, Math.min(1, element.x)) * widthM
  const x1 = Math.max(0, Math.min(1, element.x + element.width)) * widthM
  // La imagen fuente tiene y=0 arriba; el espacio local tiene y=0 en el
  // suelo, así que se invierte.
  const y0 = (1 - Math.min(1, element.y + element.height)) * heightM
  const y1 = (1 - Math.max(0, element.y)) * heightM
  return { x0, y0, x1, y1 }
}

/**
 * Construye la malla local (en metros, plano de la fachada) a partir de
 * `facade.json`. Devuelve `null` cuando faltan datos suficientes (ancho o
 * altura reales) -- el llamador debe tratarlo igual que "sin fachada",
 * cayendo al `fill-extrusion` general en vez de inventar una escala.
 */
export function buildFacadeMesh(facade: BuildingFacade): FacadeMesh | null {
  const widthM = facade.gis.frontWidthM
  const heightM = facade.dimensions.heightM
  if (!widthM || widthM <= 0 || !heightM || heightM <= 0) return null

  const builder = new MeshBuilder()
  const wallColor = hexToRgb(facade.wall.color, FACADE_COLORS.wallFallback)

  const outline = facade.outline.length >= 3 ? facade.outline : [[0, 1], [0, 0], [1, 0], [1, 1]]
  const wallPoints: [number, number][] = outline.map(([x, y]) => [
    Math.max(0, Math.min(1, x)) * widthM,
    (1 - Math.max(0, Math.min(1, y))) * heightM,
  ])
  builder.addOutlineFan(wallPoints, FACADE_Z_OFFSETS.wall, wallColor, 1)

  const addElements = (elements: FacadeElement[], z: number, rgb: [number, number, number], alpha: number) => {
    for (const element of elements) {
      if (element.width <= 0 || element.height <= 0) continue
      const { x0, y0, x1, y1 } = elementRect(element, widthM, heightM)
      if (x1 <= x0 || y1 <= y0) continue
      builder.addQuad(x0, y0, x1, y1, z, rgb, alpha)
    }
  }

  addElements(facade.windows, FACADE_Z_OFFSETS.window, hexToRgb(null, FACADE_COLORS.window), 0.85)
  addElements(facade.doors, FACADE_Z_OFFSETS.door, hexToRgb(null, FACADE_COLORS.door), 1)
  addElements(facade.garageDoors, FACADE_Z_OFFSETS.garageDoor, hexToRgb(null, FACADE_COLORS.garageDoor), 1)
  addElements(facade.balconies, FACADE_Z_OFFSETS.balcony, hexToRgb(null, FACADE_COLORS.balcony), 1)

  const mesh = builder.build()
  return mesh.vertexCount > 0 ? mesh : null
}
