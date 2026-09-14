import { describe, expect, it } from "vitest"

import { computeFacadePlacement } from "./facadePlacement"
import { makeFacade } from "./testFixtures"

describe("computeFacadePlacement", () => {
  it("devuelve null si el frontEdge esta vacio o el ancho es 0", () => {
    const facade = makeFacade({ gis: { frontEdge: [], frontWidthM: 10, frontBearing: 0 } as never })
    expect(computeFacadePlacement(facade)).toBeNull()
  })

  it("el eje 'up' siempre apunta en +z (vertical) y es independiente del heading", () => {
    const facade = makeFacade()
    const placement = computeFacadePlacement(facade)!
    expect(placement.up[0]).toBeCloseTo(0, 10)
    expect(placement.up[1]).toBeCloseTo(0, 10)
    expect(placement.up[2]).toBeGreaterThan(0)
  })

  it("'right' y 'depth' quedan perpendiculares entre si en el plano horizontal", () => {
    const facade = makeFacade()
    const placement = computeFacadePlacement(facade)!
    const dot = placement.right[0] * placement.depth[0] + placement.right[1] * placement.depth[1]
    expect(dot).toBeCloseTo(0, 6)
  })

  it("'depth' apunta hacia la posicion de la camara (calle), no hacia adentro del lote", () => {
    // Fachada este-oeste (frontEdge horizontal en longitud), camara mirando
    // desde el sur del segmento hacia el norte -- depth debe apuntar al sur.
    const facade = makeFacade({
      gis: { frontEdge: [[-77.03, -12.05], [-77.029, -12.05]], frontWidthM: 11, frontBearing: 90 },
      source: { type: "streetview", lat: -12.0505, lng: -77.0295, heading: 0, pitch: 85 },
    })
    const placement = computeFacadePlacement(facade)!
    // "Sur" en Mercator y crece hacia arriba en pantalla al reves de lat: a
    // menor latitud, mayor coordenada Mercator y. depth debe tener y > 0.
    expect(placement.depth[1]).toBeGreaterThan(0)
  })

  it("invierte 'right' cuando el heading indica que la camara mira al lado contrario del orden crudo de front_edge", () => {
    // front_edge va de oeste a este (start.lng < end.lng): el orden crudo
    // pone 'right' apuntando al este. Con heading=180 (camara mirando al
    // sur, "derecha" del observador = oeste) el criterio de orientacion
    // debe invertirlo para que coincida con izquierda->derecha de la foto.
    const facingSouth = computeFacadePlacement(makeFacade({ source: { ...makeFacade().source, heading: 180 } }))!
    const noHeading = computeFacadePlacement(
      makeFacade({ source: { ...makeFacade().source, heading: null } }),
    )!
    expect(Math.sign(facingSouth.right[0])).not.toBe(Math.sign(noHeading.right[0]))
  })

  it("sin heading, no se invierte 'right' (se conserva el orden crudo de front_edge)", () => {
    const withoutHeading = computeFacadePlacement(
      makeFacade({ source: { ...makeFacade().source, heading: null } }),
    )!
    // Orden crudo: front_edge va de oeste a este -> right apunta al este (x Mercator positivo).
    expect(withoutHeading.right[0]).toBeGreaterThan(0)
  })
})
