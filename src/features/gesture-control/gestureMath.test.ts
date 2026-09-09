import { describe, expect, it } from "vitest"

import { createGestureTracker, updateGestureTracker } from "./gestureMath"

const pinchSample = (distance: number, pinchRatio = 0.3) => ({
  hands: [
    { pinchRatio, pinchPoint: { x: 0.5 - distance / 2, y: 0.5 }, open: false, closed: false, center: { x: 0.5 - distance / 2, y: 0.5 } },
    { pinchRatio, pinchPoint: { x: 0.5 + distance / 2, y: 0.5 }, open: false, closed: false, center: { x: 0.5 + distance / 2, y: 0.5 } },
  ],
})

const openHandSample = (x: number, y = 0.5) => ({
  hands: [{ pinchRatio: 0.9, pinchPoint: { x, y }, open: true, closed: false, center: { x, y } }],
})

const fistSample = (x: number, y = 0.5) => ({
  hands: [{ pinchRatio: 0.1, pinchPoint: { x, y }, open: false, closed: true, center: { x, y } }],
})

describe("gesture zoom math", () => {
  it("calibrates and zooms in when the hands separate", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, pinchSample(0.2))).toMatchObject({ ready: true, zoomDelta: 0 })
    expect(updateGestureTracker(tracker, pinchSample(0.3))).toMatchObject({ active: true })
    expect(updateGestureTracker(tracker, pinchSample(0.4)).zoomDelta).toBeGreaterThan(0)
  })

  it("zooms out when the hands get closer", () => {
    const tracker = createGestureTracker()
    updateGestureTracker(tracker, pinchSample(0.4))
    updateGestureTracker(tracker, pinchSample(0.4))
    expect(updateGestureTracker(tracker, pinchSample(0.2)).zoomDelta).toBeLessThan(0)
  })

  it("does not react unless both hands are pinching", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, pinchSample(0.3, 0.8))).toMatchObject({ ready: false, zoomDelta: 0 })
  })
})

describe("gesture drag-pan math (closed fist)", () => {
  it("calibrates on the first fist frame without a jump, then drags", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, fistSample(0.3))).toMatchObject({ ready: true, active: false, panDelta: { dx: 0, dy: 0 } })
    const update = updateGestureTracker(tracker, fistSample(0.4))
    expect(update.active).toBe(true)
    expect(update.panDelta.dx).toBeGreaterThan(0)
  })

  it("ignores sub-threshold jitter via the dead zone", () => {
    const tracker = createGestureTracker()
    updateGestureTracker(tracker, fistSample(0.3))
    const update = updateGestureTracker(tracker, fistSample(0.30001))
    expect(update.panDelta).toEqual({ dx: 0, dy: 0 })
  })

  it("re-grabs cleanly when extending the hand then closing it into a fist", () => {
    const tracker = createGestureTracker()
    updateGestureTracker(tracker, openHandSample(0.2))
    updateGestureTracker(tracker, openHandSample(0.3))
    // Cerrar el puño debe recalibrar en la posición actual, sin salto brusco.
    const grabbed = updateGestureTracker(tracker, fistSample(0.3))
    expect(grabbed.panDelta).toEqual({ dx: 0, dy: 0 })
    const dragged = updateGestureTracker(tracker, fistSample(0.5))
    expect(dragged.panDelta.dx).toBeGreaterThan(0)
  })

  it("does not move the map with an open hand, only with a closed fist", () => {
    const tracker = createGestureTracker()
    expect(updateGestureTracker(tracker, openHandSample(0.3))).toMatchObject({ active: false, panDelta: { dx: 0, dy: 0 } })
    expect(updateGestureTracker(tracker, openHandSample(0.4))).toMatchObject({ active: false, panDelta: { dx: 0, dy: 0 } })
    expect(updateGestureTracker(tracker, openHandSample(0.6))).toMatchObject({ active: false, panDelta: { dx: 0, dy: 0 } })
  })

  it("releases the drag as soon as the fist opens", () => {
    const tracker = createGestureTracker()
    updateGestureTracker(tracker, fistSample(0.3))
    updateGestureTracker(tracker, fistSample(0.4))
    // Abrir la mano suelta el arrastre: moverla más no debe seguir paneando.
    expect(updateGestureTracker(tracker, openHandSample(0.4))).toMatchObject({ panDelta: { dx: 0, dy: 0 } })
    expect(updateGestureTracker(tracker, openHandSample(0.7))).toMatchObject({ panDelta: { dx: 0, dy: 0 } })
  })
})
