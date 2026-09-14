import { describe, expect, it } from "vitest"

import { FACADE_MIN_ZOOM, selectFacadeCandidates, shouldAttemptFacade } from "./facadeLOD"

describe("shouldAttemptFacade", () => {
  it("bloquea fachadas por debajo del zoom minimo para un lote no seleccionado", () => {
    expect(shouldAttemptFacade(FACADE_MIN_ZOOM - 1, false)).toBe(false)
  })

  it("permite fachadas desde el zoom minimo en adelante", () => {
    expect(shouldAttemptFacade(FACADE_MIN_ZOOM, false)).toBe(true)
    expect(shouldAttemptFacade(FACADE_MIN_ZOOM + 3, false)).toBe(true)
  })

  it("el lote seleccionado es una excepcion: se permite aunque el zoom sea bajo", () => {
    expect(shouldAttemptFacade(10, true)).toBe(true)
  })
})

describe("selectFacadeCandidates", () => {
  it("prioriza el lote seleccionado sobre la distancia", () => {
    const candidates = [
      { lotId: "far-but-selected", distanceToCenter: 900 },
      { lotId: "near", distanceToCenter: 5 },
    ]
    const result = selectFacadeCandidates(candidates, "far-but-selected", 5)
    expect(result[0]).toBe("far-but-selected")
    expect(result).toContain("near")
  })

  it("ordena el resto por distancia ascendente al centro", () => {
    const candidates = [
      { lotId: "c", distanceToCenter: 30 },
      { lotId: "a", distanceToCenter: 10 },
      { lotId: "b", distanceToCenter: 20 },
    ]
    expect(selectFacadeCandidates(candidates, null, 10)).toEqual(["a", "b", "c"])
  })

  it("respeta MAX_DETAILED_FACADES aunque haya mas candidatos visibles", () => {
    const candidates = Array.from({ length: 200 }, (_, i) => ({ lotId: `lot-${i}`, distanceToCenter: i }))
    const result = selectFacadeCandidates(candidates, null, 60)
    expect(result).toHaveLength(60)
    expect(result[0]).toBe("lot-0")
    expect(result[59]).toBe("lot-59")
  })

  it("una lista vacia de candidatos no revienta y devuelve vacio", () => {
    expect(selectFacadeCandidates([], "selected", 60)).toEqual([])
  })
})
