import type { Feature, FeatureCollection, Polygon } from "geojson"
import { describe, expect, it } from "vitest"

import { dedupeExactBlockGeometries } from "./dedupeCadastral"

const geometry: Polygon = {
  type: "Polygon",
  coordinates: [[[-77, -12], [-76.9, -12], [-76.9, -11.9], [-77, -12]]],
}

type Properties = Record<string, unknown>

function collection(features: Array<Feature<Polygon, Properties>>): FeatureCollection<Polygon, Properties> {
  return { type: "FeatureCollection", features }
}

describe("dedupeExactBlockGeometries", () => {
  it("conserva la manzana identica con mas lotes vinculados", () => {
    const data = collection([
      { type: "Feature", id: "derived", geometry, properties: { district_code: "006", lot_count: 1, source: "SEDAPAL_ARCGIS_DERIVED_FROM_LOTS" } },
      { type: "Feature", id: "commercial", geometry, properties: { district_code: "006", lot_count: 12, source: "SEDAPAL_ARCGIS_CATASTRO_COMERCIAL" } },
    ])

    const result = dedupeExactBlockGeometries(data)

    expect(result.features).toHaveLength(1)
    expect(result.features[0]?.id).toBe("commercial")
  })

  it("no mezcla geometrías iguales pertenecientes a distritos distintos", () => {
    const data = collection([
      { type: "Feature", id: "018", geometry, properties: { district_code: "018" } },
      { type: "Feature", id: "029", geometry, properties: { district_code: "029" } },
    ])

    expect(dedupeExactBlockGeometries(data)).toBe(data)
    expect(data.features).toHaveLength(2)
  })
})
