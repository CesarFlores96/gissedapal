import { describe, expect, it } from "vitest"

import { extendSegment } from "./geometry"

describe("extendSegment", () => {
  it("pushes both ends the requested meters along the segment", () => {
    const [start, end] = extendSegment([-77, -12], [-77, -11.9999], 10)

    expect(start[0]).toBeCloseTo(-77, 9)
    expect(end[0]).toBeCloseTo(-77, 9)
    expect((-12 - start[1]) * 111_320).toBeCloseTo(10, 6)
    expect((end[1] - -11.9999) * 111_320).toBeCloseTo(10, 6)
  })

  it("keeps a zero-length segment unchanged", () => {
    expect(extendSegment([-77, -12], [-77, -12], 10)).toEqual([[-77, -12], [-77, -12]])
  })
})
