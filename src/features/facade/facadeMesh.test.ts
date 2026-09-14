import { describe, expect, it } from "vitest"

import { buildFacadeMesh, FACADE_Z_OFFSETS } from "./facadeMesh"
import { makeFacade } from "./testFixtures"

describe("buildFacadeMesh", () => {
  it("devuelve null cuando falta altura real (no se inventa una escala)", () => {
    const facade = makeFacade({ dimensions: { levels: null, heightM: null, widthM: 10, depthM: 0.5 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("devuelve null cuando el ancho GIS es 0 o negativo", () => {
    const facade = makeFacade({ gis: { frontEdge: [[0, 0], [0, 0]], frontWidthM: 0, frontBearing: 0 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("genera al menos la malla del muro para una fachada minima sin elementos", () => {
    const mesh = buildFacadeMesh(makeFacade())
    expect(mesh).not.toBeNull()
    expect(mesh!.vertexCount).toBeGreaterThan(0)
    expect(mesh!.indices.length % 3).toBe(0)
  })

  it("todos los vertices del muro quedan en z=0 (plano de fachada)", () => {
    const mesh = buildFacadeMesh(makeFacade())!
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i + 2]).toBeCloseTo(FACADE_Z_OFFSETS.wall, 6)
    }
  })

  it("agrega una ventana como un quad recedido en Z respecto del muro", () => {
    const withoutWindow = buildFacadeMesh(makeFacade())!
    const withWindow = buildFacadeMesh(
      makeFacade({ windows: [{ x: 0.2, y: 0.3, width: 0.15, height: 0.2, floor: 1 }] }),
    )!
    // 4 vertices extra por el quad de la ventana.
    expect(withWindow.positions.length).toBe(withoutWindow.positions.length + 4 * 3)
    const windowZValues = Array.from(withWindow.positions)
      .filter((_, i) => i % 3 === 2)
      .slice(-4)
    expect(windowZValues.every((z) => Math.abs(z - FACADE_Z_OFFSETS.window) < 1e-5)).toBe(true)
  })

  it("descarta elementos con ancho o alto no positivo", () => {
    const mesh = buildFacadeMesh(
      makeFacade({ doors: [{ x: 0.1, y: 0.1, width: 0, height: 0.3 }] }),
    )!
    const baseline = buildFacadeMesh(makeFacade())!
    expect(mesh.positions.length).toBe(baseline.positions.length)
  })

  it("un balcon sobresale hacia la calle (Z positivo)", () => {
    const mesh = buildFacadeMesh(
      makeFacade({ balconies: [{ x: 0.4, y: 0.5, width: 0.2, height: 0.1 }] }),
    )!
    const lastZ = mesh.positions[mesh.positions.length - 1]
    expect(lastZ).toBeCloseTo(FACADE_Z_OFFSETS.balcony, 5)
    expect(lastZ).toBeGreaterThan(0)
  })

  it("usa una fachada rectangular estandar cuando el outline tiene menos de 3 puntos", () => {
    const mesh = buildFacadeMesh(makeFacade({ outline: [[0, 0]] }))
    expect(mesh).not.toBeNull()
    expect(mesh!.vertexCount).toBeGreaterThan(0)
  })
})
