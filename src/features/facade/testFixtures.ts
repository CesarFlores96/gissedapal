import type { BuildingFacade } from "../../types"

/** Fixture compartida entre tests de `features/facade/*`. No se publica
 * fuera del módulo: si algo la necesita afuera, la fachada de prueba
 * pertenece a un lugar mejor que este directorio. */
export function makeFacade(overrides: Partial<BuildingFacade> = {}): BuildingFacade {
  return {
    version: 1,
    lotId: "lot-1",
    source: { type: "streetview", lat: -12.05, lng: -77.03, heading: 0, pitch: 85 },
    gis: { frontEdge: [[-77.03, -12.05], [-77.0299, -12.05]], frontWidthM: 10, frontBearing: 90 },
    dimensions: { levels: 2, heightM: 5.6, widthM: 10, depthM: 0.5 },
    outline: [[0, 1], [0, 0], [1, 0], [1, 1]],
    wall: { color: "#D8D5CF", material: "tarrajeado" },
    windows: [],
    doors: [],
    garageDoors: [],
    balconies: [],
    cornices: [],
    confidence: { semantic: 0.9, geometry: 0.8 },
    updatedAt: "2026-09-14T00:00:00Z",
    ...overrides,
  }
}
