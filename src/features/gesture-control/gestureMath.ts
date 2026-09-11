export type HandSample = {
  pinchRatio: number
  pinchPoint: { x: number; y: number }
  open: boolean
  pointing: boolean
  center: { x: number; y: number }
}

export type GestureSample = {
  hands: HandSample[]
}

export type GestureTracker = {
  lastDistance: number | null
  smoothedDistance: number | null
  zoomLostFrames: number
  dragCenter: { x: number; y: number } | null
  dragLostFrames: number
  active: boolean
}

export type GestureUpdate = {
  ready: boolean
  active: boolean
  zoomDelta: number
  panDelta: { dx: number; dy: number }
}

const PINCH_RATIO_MAX = 0.48
const ZOOM_DEAD_ZONE = 0.006
const MAX_ZOOM_STEP = 0.12
const MAX_LOST_FRAMES = 6
// Suaviza el ruido de detección frame a frame antes de derivar velocidades,
// para que el zoom/paneo se vea continuo en vez de saltar entre "fotogramas".
const DISTANCE_SMOOTHING = 0.55

// Arrastre apuntando con el índice (los otros dedos doblados): es el ÚNICO
// gesto que mueve el mapa. Se eligió sobre el puño cerrado porque un puño se
// confunde con un pellizco cuando el pulgar queda cerca del índice al curvar
// los demás dedos; apuntar no depende del pulgar y no es ambiguo con ningún
// otro gesto reconocido acá. Mostrar la mano abierta no debe desplazar nada;
// solo sirve para "soltar" el arrastre. El paneo sigue el movimiento del dedo
// 1:1 fotograma a fotograma, igual que arrastrar con el dedo en la pantalla
// de un celular: mover el dedo mueve el mapa, dejarlo quieto lo detiene sin
// importar en qué punto del cuadro haya quedado (a diferencia de un joystick,
// donde alejarse del punto de partida sigue paneando aunque no te muevas).
const DRAG_SMOOTHING = 0.65
const DRAG_DEAD_ZONE = 0.0008
const DRAG_MAX_STEP = 0.35
const DRAG_GAIN = 1.8

const NO_PAN = { dx: 0, dy: 0 }

export function createGestureTracker(): GestureTracker {
  return {
    lastDistance: null,
    smoothedDistance: null,
    zoomLostFrames: 0,
    dragCenter: null,
    dragLostFrames: 0,
    active: false,
  }
}

function smooth(previous: number | null, next: number, factor: number): number {
  return previous === null ? next : previous + (next - previous) * factor
}

function clamp(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value))
}

function pinchDistance(hands: HandSample[]): number | null {
  if (hands.length !== 2 || hands.some((hand) => hand.pinchRatio > PINCH_RATIO_MAX)) return null
  const [first, second] = hands
  const distance = Math.hypot(first.pinchPoint.x - second.pinchPoint.x, first.pinchPoint.y - second.pinchPoint.y)
  return distance < 0.08 ? null : distance
}

function resetZoom(tracker: GestureTracker): void {
  tracker.lastDistance = null
  tracker.smoothedDistance = null
}

function resetDrag(tracker: GestureTracker): void {
  tracker.dragCenter = null
}

type TrackedCenter = { x: number; y: number }

function trackCenter(
  previous: TrackedCenter | null,
  next: TrackedCenter,
  smoothing: number,
  deadZone: number,
  maxStep: number,
  gain: number,
): { center: TrackedCenter; delta: { dx: number; dy: number } | null } {
  const center = previous === null
    ? next
    : { x: smooth(previous.x, next.x, smoothing), y: smooth(previous.y, next.y, smoothing) }
  if (previous === null) return { center, delta: null }
  const dx = clamp((center.x - previous.x) * gain, maxStep)
  const dy = clamp((center.y - previous.y) * gain, maxStep)
  if (Math.abs(dx) < deadZone && Math.abs(dy) < deadZone) return { center, delta: NO_PAN }
  return { center, delta: { dx: Math.abs(dx) < deadZone ? 0 : dx, dy: Math.abs(dy) < deadZone ? 0 : dy } }
}

export function updateGestureTracker(tracker: GestureTracker, sample: GestureSample): GestureUpdate {
  const distance = pinchDistance(sample.hands)

  if (distance !== null) {
    tracker.zoomLostFrames = 0
    resetDrag(tracker)
    const smoothed = smooth(tracker.smoothedDistance, distance, DISTANCE_SMOOTHING)
    tracker.smoothedDistance = smoothed
    if (tracker.lastDistance === null) {
      tracker.lastDistance = smoothed
      tracker.active = false
      return { ready: true, active: false, zoomDelta: 0, panDelta: NO_PAN }
    }
    const ratio = smoothed / tracker.lastDistance
    tracker.lastDistance = smoothed
    tracker.active = true
    const rawDelta = Math.log2(ratio) * 0.9
    const zoomDelta = Math.abs(rawDelta) < ZOOM_DEAD_ZONE ? 0 : clamp(rawDelta, MAX_ZOOM_STEP)
    return { ready: true, active: true, zoomDelta, panDelta: NO_PAN }
  }

  tracker.zoomLostFrames += 1
  if (tracker.zoomLostFrames > MAX_LOST_FRAMES) resetZoom(tracker)

  const singleHand = sample.hands.length === 1 ? sample.hands[0] : null

  if (singleHand?.pointing) {
    tracker.dragLostFrames = 0
    const { center, delta } = trackCenter(
      tracker.dragCenter, singleHand.center, DRAG_SMOOTHING, DRAG_DEAD_ZONE, DRAG_MAX_STEP, DRAG_GAIN,
    )
    tracker.dragCenter = center
    tracker.active = delta !== null
    return { ready: true, active: tracker.active, zoomDelta: 0, panDelta: delta ?? NO_PAN }
  }

  // Mano abierta (o cualquier otro estado de una sola mano): suelta el
  // arrastre sin mover el mapa. Solo sirve como indicador de "lista".
  if (singleHand) {
    resetDrag(tracker)
    tracker.dragLostFrames = 0
    tracker.active = false
    return { ready: true, active: false, zoomDelta: 0, panDelta: NO_PAN }
  }

  tracker.dragLostFrames += 1
  if (tracker.dragLostFrames > MAX_LOST_FRAMES) resetDrag(tracker)
  if (tracker.zoomLostFrames > MAX_LOST_FRAMES && tracker.dragLostFrames > MAX_LOST_FRAMES) tracker.active = false

  return { ready: false, active: tracker.active, zoomDelta: 0, panDelta: NO_PAN }
}
