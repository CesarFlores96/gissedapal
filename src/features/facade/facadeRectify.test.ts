import { describe, expect, it } from "vitest"

import { extrusionHeightForLevels } from "./buildingHeight"
import { homography, rectifyFacade } from "./facadeRectify"
import { makeFacade } from "./testFixtures"

describe("homography", () => {
  it("lleva cada esquina del cuadrilátero a la esquina correspondiente del cuadrado unidad", () => {
    const quad: [number, number][] = [[0.09, 0.33], [0.945, 0.27], [0.91, 0.63], [0.056, 0.571]]
    const unit: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const map = homography(quad, unit)!
    quad.forEach((point, i) => {
      const [u, v] = map(point)
      expect(u).toBeCloseTo(unit[i][0], 9)
      expect(v).toBeCloseTo(unit[i][1], 9)
    })
  })
})

describe("rectifyFacade", () => {
  it("un elemento en coordenadas de la foto queda relativo al edificio, no a la imagen", () => {
    // Edificio ocupa x 0.2..0.8, y 0.3..0.7 de la foto; portón pegado al suelo a la izquierda.
    const facade = makeFacade({
      outline: [[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]],
      garageDoors: [{ x: 0.2, y: 0.5, width: 0.15, height: 0.2 }],
    })
    const [door] = rectifyFacade(facade).garageDoors
    expect(door.x).toBeCloseTo(0, 6)
    expect(door.width).toBeCloseTo(0.25, 6)
    expect(door.y).toBeCloseTo(0.5, 6)
    expect(door.y + door.height).toBeCloseTo(1, 6)
  })

  it("no depende del orden en que vienen los vértices del contorno", () => {
    const element = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }
    const ordered = rectifyFacade(makeFacade({ outline: [[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]], windows: [element] }))
    const shuffled = rectifyFacade(makeFacade({ outline: [[0.8, 0.7], [0.2, 0.3], [0.2, 0.7], [0.8, 0.3]], windows: [element] }))
    expect(shuffled.windows[0].x).toBeCloseTo(ordered.windows[0].x, 9)
    expect(shuffled.windows[0].y).toBeCloseTo(ordered.windows[0].y, 9)
  })

  it("descarta elementos que caen fuera del edificio", () => {
    const facade = makeFacade({
      outline: [[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]],
      windows: [{ x: 0.85, y: 0.1, width: 0.1, height: 0.1 }],
    })
    expect(rectifyFacade(facade).windows).toHaveLength(0)
  })

  it("con contorno de más de 4 vértices usa la caja envolvente", () => {
    const facade = makeFacade({
      outline: [[0.2, 0.3], [0.5, 0.25], [0.8, 0.3], [0.8, 0.75], [0.2, 0.75]],
      doors: [{ x: 0.5, y: 0.5, width: 0.1, height: 0.25 }],
    })
    const [door] = rectifyFacade(facade).doors
    expect(door.x).toBeCloseTo(0.5, 6)
    expect(door.y + door.height).toBeCloseTo(1, 6)
  })

  it("sin contorno útil deja las posiciones como vienen", () => {
    const window = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
    const [result] = rectifyFacade(makeFacade({ outline: [], windows: [window] })).windows
    for (const key of ["x", "y", "width", "height"] as const) expect(result[key]).toBeCloseTo(window[key], 9)
  })

  it("caso real (lote 6ccefdca, 2026-09-14): el portón queda apoyado en el suelo del frente", () => {
    const facade = makeFacade({
      outline: [[0.09, 0.33], [0.9454314720812182, 0.27], [0.9098984771573604, 0.63], [0.056043570149888935, 0.5711325802936413]],
      garageDoors: [{ x: 0.1, y: 0.37, width: 0.14, height: 0.21 }],
    })
    const [gate] = rectifyFacade(facade).garageDoors
    expect(gate.x).toBeLessThan(0.1)
    expect(gate.y + gate.height).toBeGreaterThan(0.9)
    expect(gate.y).toBeGreaterThan(0.1)
  })
})

describe("extrusionHeightForLevels", () => {
  it("reproduce los stops de la expresión de MapLibre y satura en los extremos", () => {
    expect(extrusionHeightForLevels(-1)).toBe(1.2)
    expect(extrusionHeightForLevels(0)).toBe(1.2)
    expect(extrusionHeightForLevels(1)).toBe(3)
    expect(extrusionHeightForLevels(2)).toBeCloseTo(6, 9)
    expect(extrusionHeightForLevels(5)).toBe(15)
    expect(extrusionHeightForLevels(40)).toBe(60)
  })
})
