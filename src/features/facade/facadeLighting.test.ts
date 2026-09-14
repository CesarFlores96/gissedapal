import { describe, expect, it } from "vitest"

import { lightInFacadeSpace, mapLightDirection } from "./facadeLighting"

describe("mapLightDirection", () => {
  it("con la luz por defecto de MapLibre viene desde arriba y es unitaria", () => {
    const light = mapLightDirection(undefined, 0)
    expect(Math.hypot(...light)).toBeCloseTo(1, 9)
    expect(light[2]).toBeGreaterThan(0.8)
  })

  it("anclada a la vista, gira con el bearing del mapa", () => {
    const north = mapLightDirection(undefined, 0)
    const rotated = mapLightDirection(undefined, 90)
    expect(rotated[2]).toBeCloseTo(north[2], 9)
    // Rotar 90° lleva (x, y) a (-y, x).
    expect(rotated[0]).toBeCloseTo(-north[1], 9)
    expect(rotated[1]).toBeCloseTo(north[0], 9)
  })

  it("anclada al mapa, el bearing no la mueve", () => {
    const light = { position: [1.15, 210, 30] as [number, number, number], anchor: "map" as const }
    expect(mapLightDirection(light, 0)).toEqual(mapLightDirection(light, 137))
  })
})

describe("lightInFacadeSpace", () => {
  it("proyecta la luz sobre los ejes de la fachada y conserva la componente vertical", () => {
    // Fachada con frente hacia el sur (depth = +y Mercator), recorrida de oeste a este.
    const local = lightInFacadeSpace([0, 1, 0], [2e-8, 0, 0], [0, 2e-8, 0])
    expect(local).toEqual([0, 0, 1])
    expect(lightInFacadeSpace([0.6, 0, 0.8], [1, 0, 0], [0, 1, 0])).toEqual([0.6, 0.8, 0])
  })
})
