import { describe, expect, it } from "vitest"

import type { FacadeElement } from "../../types"
import type { RectifiedFacade } from "./facadeRectify"
import { regularizeFacadeElements } from "./facadeRegularize"

const W = 10
const H = 9
const FLOORS = 3 // 3 m por piso

function facade(parts: Partial<RectifiedFacade>): RectifiedFacade {
  return { windows: [], doors: [], garageDoors: [], balconies: [], ...parts }
}

/** Recuadro en coordenadas de fachada normalizadas (y=0 techo), a partir de metros. */
function box(x0: number, x1: number, yBottom: number, yTop: number, extra: Partial<FacadeElement> = {}): FacadeElement {
  return { x: x0 / W, width: (x1 - x0) / W, y: 1 - yTop / H, height: (yTop - yBottom) / H, ...extra }
}

describe("regularizeFacadeElements", () => {
  it("alinea todas las ventanas de un piso a la misma altura de antepecho y dintel", () => {
    const { openings } = regularizeFacadeElements(facade({
      windows: [box(1, 2.5, 3.8, 5.6), box(4, 5.2, 4.1, 5.0), box(7, 8.4, 3.6, 5.3)],
    }), W, H, FLOORS)
    expect(openings).toHaveLength(3)
    for (const { rect, floor } of openings) {
      expect(floor).toBe(2)
      expect(rect.y0).toBeCloseTo(3 + 0.3 * 3, 6)
      expect(rect.y1).toBeCloseTo(3 + 0.8 * 3, 6)
    }
  })

  it("descarta tubos, cables y recuadros diminutos", () => {
    const { openings } = regularizeFacadeElements(facade({
      windows: [box(3, 3.12, 1, 8), box(5, 5.2, 4, 4.2), box(6, 7.5, 3.5, 5)],
    }), W, H, FLOORS)
    expect(openings.map((o) => o.rect.x0)).toEqual([6])
  })

  it("apoya puertas y portones en el nivel del piso", () => {
    const { openings } = regularizeFacadeElements(facade({
      doors: [box(1, 2, 0.6, 2.4)],
      garageDoors: [box(4, 7, 0.4, 2.2)],
    }), W, H, FLOORS)
    const door = openings.find((o) => o.kind === "door")!
    const garage = openings.find((o) => o.kind === "garageDoor")!
    expect(door.rect.y0).toBe(0)
    expect(garage.rect.y0).toBe(0)
    expect(door.rect.y1).toBeCloseTo(0.73 * 3, 6)
  })

  it("un portón demasiado angosto se dibuja como puerta", () => {
    const { openings } = regularizeFacadeElements(facade({ garageDoors: [box(4, 4.9, 0, 2.2)] }), W, H, FLOORS)
    expect(openings[0].kind).toBe("door")
  })

  it("respeta el piso que marcó Gemma aunque el recuadro caiga en otro", () => {
    const { openings } = regularizeFacadeElements(facade({ windows: [box(2, 3.5, 2.4, 3.4, { piso: 3 })] }), W, H, FLOORS)
    expect(openings[0].floor).toBe(3)
    expect(openings[0].rect.y0).toBeCloseTo(6 + 0.9, 6)
  })

  it("una ventana que se superpone con una puerta ya ubicada es un duplicado", () => {
    const { openings } = regularizeFacadeElements(facade({
      doors: [box(1, 2.2, 0, 2.2)],
      windows: [box(1.1, 2.1, 1, 2)],
    }), W, H, FLOORS)
    expect(openings.map((o) => o.kind)).toEqual(["door"])
  })

  it("un ventanal alto baja el antepecho en vez de recortarse", () => {
    const { openings } = regularizeFacadeElements(facade({ windows: [box(1, 4, 3.1, 5.8)] }), W, H, FLOORS)
    expect(openings[0].rect.y0).toBeCloseTo(3 + 0.1 * 3, 6)
  })

  it("los huecos nunca se salen de los bordes de la fachada", () => {
    const { openings } = regularizeFacadeElements(facade({ garageDoors: [box(9.5, 10, 0, 2)] }), W, H, FLOORS)
    expect(openings[0].rect.x1).toBeLessThanOrEqual(W)
    expect(openings[0].rect.x0).toBeGreaterThanOrEqual(0)
  })

  it("ubica el balcón como losa al nivel de su piso y lo omite en planta baja", () => {
    const { balconies } = regularizeFacadeElements(facade({
      balconies: [box(1, 4, 3.4, 3.7), box(5, 8, 0.8, 1.1)],
    }), W, H, FLOORS)
    expect(balconies).toHaveLength(1)
    expect(balconies[0].floor).toBe(2)
    expect((balconies[0].rect.y0 + balconies[0].rect.y1) / 2).toBeCloseTo(3, 6)
  })
})
