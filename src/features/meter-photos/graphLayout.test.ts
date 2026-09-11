import { describe, it, expect } from "vitest"
import { computeLayout, fitTransform } from "./graphLayout"
import { filterGraph, matchesSearch, nodeRadius } from "./incidenceGraph"
import type { IncidenceGraph } from "./types"

const graph: IncidenceGraph = {
  nodes: [{ incidence: "Conexión Con Fuga", source: "estado_conexion", photo_count: 20 }, { incidence: "Requiere revisión", source: "revision", photo_count: 100 }],
  edges: [{ source_incidence: "Conexión Con Fuga", target_incidence: "Requiere revisión", weight: 20 }], totalPhotos: 100,
}

describe("incidence graph", () => {
  it("keeps layout stable and drops dangling edges", () => {
    const input = { ...graph, edges: [...graph.edges, { source_incidence: "missing", target_incidence: "Requiere revisión", weight: 1 }] }
    const first = computeLayout(input, 900, 500)
    expect(first).toEqual(computeLayout(input, 900, 500))
    expect(first.edges).toHaveLength(1)
    expect(first.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
    expect(fitTransform(first, 320, 450).k).toBeGreaterThan(0)
  })
  it("searches accents, serials and leading zeros without changing values", () => {
    expect(matchesSearch({ incidence: "Conexión", lecturas: ["00012"] }, "conexion")).toBe(true)
    expect(matchesSearch({ incidence: "Conexión", lecturas: ["00012"] }, "00012")).toBe(true)
    expect(filterGraph(graph, "fuga").edges).toHaveLength(0)
    expect(nodeRadius(1, 100)).toBeLessThan(nodeRadius(100, 100))
  })
})
