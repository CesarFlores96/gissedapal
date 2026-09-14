import { beforeEach, describe, expect, it } from "vitest"

import { cachedFacadeCount, clearFacadeCache, getCachedFacade, invalidateCachedFacade, setCachedFacade } from "./facadeStore"
import { makeFacade } from "./testFixtures"

beforeEach(() => {
  clearFacadeCache()
})

describe("facadeStore", () => {
  it("empieza vacio y devuelve undefined para un lote no cacheado", () => {
    expect(getCachedFacade("nope")).toBeUndefined()
    expect(cachedFacadeCount()).toBe(0)
  })

  it("guarda y recupera una fachada", () => {
    const facade = makeFacade()
    expect(setCachedFacade(facade.lotId, facade)).toBe(true)
    expect(getCachedFacade(facade.lotId)).toBe(facade)
    expect(cachedFacadeCount()).toBe(1)
  })

  it("no reemplaza el valor cacheado si version y updatedAt son iguales", () => {
    const first = makeFacade()
    const second = makeFacade()
    setCachedFacade("lot-1", first)
    const replaced = setCachedFacade("lot-1", second)
    expect(replaced).toBe(false)
    expect(getCachedFacade("lot-1")).toBe(first)
  })

  it("reemplaza cuando version cambia (reanalisis)", () => {
    setCachedFacade("lot-1", makeFacade({ version: 1 }))
    const newer = makeFacade({ version: 2, updatedAt: "2026-09-14T01:00:00Z" })
    const replaced = setCachedFacade("lot-1", newer)
    expect(replaced).toBe(true)
    expect(getCachedFacade("lot-1")).toBe(newer)
  })

  it("invalidateCachedFacade borra solo el lote indicado", () => {
    setCachedFacade("lot-1", makeFacade({ lotId: "lot-1" }))
    setCachedFacade("lot-2", makeFacade({ lotId: "lot-2" }))
    invalidateCachedFacade("lot-1")
    expect(getCachedFacade("lot-1")).toBeUndefined()
    expect(getCachedFacade("lot-2")).toBeDefined()
  })
})
