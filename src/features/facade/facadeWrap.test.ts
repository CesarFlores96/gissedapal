import { describe, expect, it } from "vitest"

import type { BuildingFacade } from "../../types"
import { computeFacadePlacement } from "./facadePlacement"
import { computeFacadeWrap } from "./facadeWrap"
import { makeFacade } from "./testFixtures"

// Lote en esquina: frente sur SW->SE y costado oeste SW->NW, ~11 m cada uno.
const SW: [number, number] = [-77.03, -12.05]
const SE: [number, number] = [-77.0299, -12.05]
const NW: [number, number] = [-77.03, -12.0499]
const FRONT_WIDTH_M = 0.0001 * 111_320 * Math.cos((12.05 * Math.PI) / 180)

function cornerFacade(overrides: Partial<BuildingFacade> = {}): BuildingFacade {
  return makeFacade({
    // Cámara al suroeste de la esquina, mirando al noreste.
    source: { type: "streetview", lat: -12.05008, lng: -77.03008, heading: 45, pitch: 85 },
    gis: { frontEdge: [SW, SE], wrapEdge: [NW, SW, SE], frontWidthM: FRONT_WIDTH_M, frontBearing: 90 },
    ...overrides,
  })
}

function wrapOf(facade: BuildingFacade) {
  return computeFacadeWrap(facade, computeFacadePlacement(facade)!)!
}

describe("computeFacadeWrap", () => {
  it("lleva la envolvente al marco local: frente sobre z=0 y costado hacia adentro del lote", () => {
    const { points } = wrapOf(cornerFacade())
    const first = points[0]
    const last = points[points.length - 1]
    // De izquierda a derecha de la foto: fondo del costado oeste -> esquina -> extremo este del frente.
    expect(first.x).toBeCloseTo(0, 1)
    expect(first.z).toBeLessThan(-10)
    expect(last.x).toBeCloseTo(FRONT_WIDTH_M, 1)
    expect(last.z).toBeCloseTo(0, 1)
    const corner = points.find((p) => Math.abs(p.x) < 0.05 && Math.abs(p.z) < 0.05)!
    expect(corner).toBeDefined()
  })

  it("reparte la foto por la proyección de la cámara: u monótona de 0 a 1, esquina en el medio", () => {
    const { points } = wrapOf(cornerFacade())
    expect(points[0].u).toBe(0)
    expect(points[points.length - 1].u).toBe(1)
    for (let i = 1; i < points.length; i += 1) expect(points[i].u).toBeGreaterThanOrEqual(points[i - 1].u)
    const corner = points.find((p) => Math.abs(p.x) < 0.05 && Math.abs(p.z) < 0.05)!
    // Vista a 45° sobre una esquina simétrica: cada cara ocupa ~la mitad.
    expect(corner.u).toBeGreaterThan(0.35)
    expect(corner.u).toBeLessThan(0.65)
    // Subdividida: los tramos de ~11 m se parten en piezas de <= 1 m.
    expect(points.length).toBeGreaterThan(20)
  })

  it("la cámara queda del lado de afuera de ambas caras", () => {
    const { camera } = wrapOf(cornerFacade())
    expect(camera[0]).toBeLessThan(0)
    expect(camera[1]).toBeGreaterThan(0)
  })

  it("sin wrapEdge usa solo el frente, con la foto entera de extremo a extremo", () => {
    const facade = cornerFacade({ gis: { frontEdge: [SW, SE], frontWidthM: FRONT_WIDTH_M, frontBearing: 90 } })
    const { points } = wrapOf(facade)
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.u)).toEqual([0, 1])
    expect(points[0].x).toBeCloseTo(0, 1)
    expect(points[1].x).toBeCloseTo(FRONT_WIDTH_M, 1)
  })

  it("ignora un wrapEdge que no contiene el frente (dato viejo o de otra geometría)", () => {
    const facade = cornerFacade({
      gis: { frontEdge: [SW, SE], wrapEdge: [[-77.1, -12.1], [-77.2, -12.2]], frontWidthM: FRONT_WIDTH_M, frontBearing: 90 },
    })
    expect(wrapOf(facade).points).toHaveLength(2)
  })

  it("sin heading reparte la foto por longitud", () => {
    const { points } = wrapOf(cornerFacade({ source: { type: "streetview", lat: -12.05008, lng: -77.03008, heading: null, pitch: 85 } }))
    expect(points[0].u).toBe(0)
    expect(points[points.length - 1].u).toBeCloseTo(1, 9)
    const corner = points.find((p) => Math.abs(p.x) < 0.05 && Math.abs(p.z) < 0.05)!
    expect(corner.u).toBeCloseTo(0.5, 1)
  })
})
