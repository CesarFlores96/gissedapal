import { describe, expect, it } from "vitest"

import { createGestureTracker, updateGestureTracker } from "./gestureMath"

const sample = (distance: number, pinchRatio = 0.3) => ({
  hands: [
    { pinchRatio, pinchPoint: { x: 0.5 - distance / 2, y: 0.5 } },
    { pinchRatio, pinchPoint: { x: 0.5 + distance / 2, y: 0.5 } },
  ],
})

describe("gesture zoom math", () => {
  it("calibrates and zooms in when the hands separate", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, sample(0.2))).toMatchObject({ ready: true, zoomDelta: 0 })
    expect(updateGestureTracker(tracker, sample(0.3))).toMatchObject({ active: true })
    expect(updateGestureTracker(tracker, sample(0.4)).zoomDelta).toBeGreaterThan(0)
  })

  it("zooms out when the hands get closer", () => {
    const tracker = createGestureTracker()
    updateGestureTracker(tracker, sample(0.4))
    expect(updateGestureTracker(tracker, sample(0.2)).zoomDelta).toBeLessThan(0)
  })

  it("does not react unless both hands are pinching", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, sample(0.3, 0.8))).toMatchObject({ ready: false, zoomDelta: 0 })
  })
})
