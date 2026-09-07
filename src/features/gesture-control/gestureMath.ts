export type HandSample = {
  pinchRatio: number
  pinchPoint: { x: number; y: number }
}

export type GestureSample = {
  hands: HandSample[]
}

export type GestureTracker = {
  lastDistance: number | null
  lostFrames: number
  active: boolean
}

export type GestureUpdate = {
  ready: boolean
  active: boolean
  zoomDelta: number
}

const PINCH_RATIO_MAX = 0.48
const DEAD_ZONE = 0.006
const MAX_ZOOM_STEP = 0.12
const MAX_LOST_FRAMES = 6

export function createGestureTracker(): GestureTracker {
  return { lastDistance: null, lostFrames: 0, active: false }
}

function distanceBetweenHands(hands: HandSample[]): number | null {
  if (hands.length !== 2 || hands.some((hand) => hand.pinchRatio > PINCH_RATIO_MAX)) return null
  const [first, second] = hands
  return Math.hypot(first.pinchPoint.x - second.pinchPoint.x, first.pinchPoint.y - second.pinchPoint.y)
}

export function updateGestureTracker(tracker: GestureTracker, sample: GestureSample): GestureUpdate {
  const distance = distanceBetweenHands(sample.hands)
  if (distance === null || distance < 0.08) {
    tracker.lostFrames += 1
    if (tracker.lostFrames > MAX_LOST_FRAMES) {
      tracker.lastDistance = null
      tracker.active = false
    }
    return { ready: false, active: tracker.active, zoomDelta: 0 }
  }

  tracker.lostFrames = 0
  if (tracker.lastDistance === null) {
    tracker.lastDistance = distance
    tracker.active = false
    return { ready: true, active: false, zoomDelta: 0 }
  }

  const ratio = distance / tracker.lastDistance
  tracker.lastDistance = distance
  tracker.active = true
  const rawDelta = Math.log2(ratio) * 0.9
  const zoomDelta = Math.abs(rawDelta) < DEAD_ZONE
    ? 0
    : Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, rawDelta))
  return { ready: true, active: true, zoomDelta }
}
