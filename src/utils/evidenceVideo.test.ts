import { describe, expect, it } from "vitest"

import { base64ToBlob, base64ToBytes, cacheVideoBlob, getCachedVideoBlob } from "./evidenceVideo"

describe("base64ToBytes", () => {
  it("reconstruye los bytes exactos, incluidos 0 y 255", () => {
    const bytes = new Uint8Array([0, 255, 16, 128, 7])

    expect(base64ToBytes(btoa(String.fromCharCode(...bytes)))).toEqual(bytes)
  })

  it("envuelve los bytes en un Blob con el tipo declarado", () => {
    const blob = base64ToBlob(btoa(String.fromCharCode(0, 255, 16)), "video/mp4")

    expect(blob.type).toBe("video/mp4")
    expect(blob.size).toBe(3)
  })
})

describe("cacheVideoBlob", () => {
  it("devuelve el mismo blob que guarda", () => {
    const blob = base64ToBlob(btoa("mp4"), "video/mp4")

    expect(cacheVideoBlob("/uploads/supervision-media/a/b/v.mp4", blob)).toBe(blob)
    expect(getCachedVideoBlob("/uploads/supervision-media/a/b/v.mp4")).toBe(blob)
  })

  it("descarta los más antiguos al pasar del tope", () => {
    for (let index = 0; index < 20; index += 1) {
      cacheVideoBlob(`/uploads/supervision-media/a/b/${index}.mp4`, base64ToBlob(btoa("x"), "video/mp4"))
    }

    expect(getCachedVideoBlob("/uploads/supervision-media/a/b/0.mp4")).toBeUndefined()
    expect(getCachedVideoBlob("/uploads/supervision-media/a/b/19.mp4")).toBeDefined()
  })
})
