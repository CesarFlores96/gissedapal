import { describe, expect, it } from "vitest"

import { buildFacadeMesh, FACADE_MAX_DEPTH_M, FACADE_Z_OFFSETS } from "./facadeMesh"
import { makeFacade } from "./testFixtures"

function zValues(positions: Float32Array): number[] {
  return Array.from(positions).filter((_, i) => i % 3 === 2)
}

/** Área de la cara frontal (z=0, orientada en el plano x,y) sumando triángulos. */
function frontFaceArea(mesh: NonNullable<ReturnType<typeof buildFacadeMesh>>): number {
  let area = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map((i) => i * 3)
    const zs = [mesh.positions[a + 2], mesh.positions[b + 2], mesh.positions[c + 2]]
    if (!zs.every((z) => Math.abs(z) < 1e-6)) continue
    const ux = mesh.positions[b] - mesh.positions[a]
    const uy = mesh.positions[b + 1] - mesh.positions[a + 1]
    const vx = mesh.positions[c] - mesh.positions[a]
    const vy = mesh.positions[c + 1] - mesh.positions[a + 1]
    area += Math.abs(ux * vy - uy * vx) / 2
  }
  return area
}

describe("buildFacadeMesh", () => {
  it("devuelve null cuando falta altura real (no se inventa una escala)", () => {
    const facade = makeFacade({ dimensions: { levels: null, heightM: null, widthM: 10, depthM: 0.5 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("devuelve null cuando el ancho GIS es 0 o negativo", () => {
    const facade = makeFacade({ gis: { frontEdge: [[0, 0], [0, 0]], frontWidthM: 0, frontBearing: 0 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("una fachada sin elementos es una losa: cara frontal completa en z=0 y espesor detrás", () => {
    const mesh = buildFacadeMesh(makeFacade())!
    expect(mesh.indices.length % 3).toBe(0)
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * 5.6, 4)
    const zs = zValues(mesh.positions)
    expect(Math.max(...zs)).toBeCloseTo(0, 6)
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 6)
  })

  it("el espesor queda acotado a la maqueta (nunca la profundidad real del predio)", () => {
    const mesh = buildFacadeMesh(makeFacade({ dimensions: { levels: 2, heightM: 5.6, widthM: 10, depthM: 25 } }))!
    expect(Math.min(...zValues(mesh.positions))).toBeCloseTo(-FACADE_MAX_DEPTH_M, 6)
  })

  it("una ventana abre un hueco real en la cara frontal y su fondo queda recedido", () => {
    const window = { x: 0.2, y: 0.3, width: 0.15, height: 0.2, floor: 1 }
    const mesh = buildFacadeMesh(makeFacade({ windows: [window] }))!
    const holeArea = 0.15 * 10 * 0.2 * 5.6
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * 5.6 - holeArea, 4)
    expect(zValues(mesh.positions).some((z) => Math.abs(z - FACADE_Z_OFFSETS.window) < 1e-6)).toBe(true)
  })

  it("descarta elementos con ancho o alto no positivo", () => {
    const mesh = buildFacadeMesh(makeFacade({ doors: [{ x: 0.1, y: 0.1, width: 0, height: 0.3 }] }))!
    const baseline = buildFacadeMesh(makeFacade())!
    expect(mesh.positions.length).toBe(baseline.positions.length)
  })

  it("un balcon sobresale hacia la calle (Z positivo) sin abrir hueco", () => {
    const mesh = buildFacadeMesh(makeFacade({ balconies: [{ x: 0.4, y: 0.5, width: 0.2, height: 0.1 }] }))!
    expect(Math.max(...zValues(mesh.positions))).toBeCloseTo(FACADE_Z_OFFSETS.balcony, 5)
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * 5.6, 4)
  })

  it("usa una fachada rectangular estandar cuando el outline tiene menos de 3 puntos", () => {
    const mesh = buildFacadeMesh(makeFacade({ outline: [[0, 0]] }))
    expect(mesh).not.toBeNull()
    expect(frontFaceArea(mesh!)).toBeCloseTo(10 * 5.6, 4)
  })
})
