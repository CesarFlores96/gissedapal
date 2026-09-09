import { HandLandmarker } from "@mediapipe/tasks-vision"
// El glue wasm se carga en runtime con import() dinámico, así que su URL debe salir del
// bundler (?url) y no de /public: Vite le añade `?import` a ese import() y entonces se
// niega a servir archivos de /public en desarrollo. La variante `_module_` es la única
// que expone globalThis.ModuleFactory al ser cargada como módulo ES, que es lo que
// necesita un module worker (ahí importScripts lanza TypeError).
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url"
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url"

type WorkerRequest =
  | { type: "init"; modelPath: string }
  | { type: "detect"; bitmap: ImageBitmap; timestamp: number }
  | { type: "dispose" }

type WorkerResponse =
  | { type: "ready" }
  | {
      type: "result"
      hands: Array<{
        pinchRatio: number
        pinchPoint: { x: number; y: number }
        open: boolean
        closed: boolean
        center: { x: number; y: number }
      }>
    }
  | { type: "error"; message: string }

// Puntas y articulaciones PIP de los cuatro dedos largos (se excluye el pulgar,
// cuya extensión es menos fiable con esta heurística de distancia a la muñeca).
const FINGER_TIPS = [8, 12, 16, 20]
const FINGER_PIPS = [6, 10, 14, 18]
const OPEN_HAND_MIN_EXTENDED = 3
// Deja un margen (1 dedo) como zona neutra entre "abierta" y "puño" para que el
// conteo no oscile entre ambos estados por ruido de landmarks.
const CLOSED_HAND_MAX_EXTENDED = 1

let handLandmarker: HandLandmarker | null = null

function post(message: WorkerResponse): void {
  self.postMessage(message)
}

function pointDistance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  try {
    if (event.data.type === "init") {
      handLandmarker = await HandLandmarker.createFromOptions({ wasmBinaryPath, wasmLoaderPath }, {
        baseOptions: { modelAssetPath: event.data.modelPath },
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        numHands: 2,
        runningMode: "VIDEO",
      })
      post({ type: "ready" })
      return
    }

    if (event.data.type === "dispose") {
      handLandmarker?.close()
      handLandmarker = null
      return
    }

    if (event.data.type === "detect") {
      if (!handLandmarker) return
      const result = handLandmarker.detectForVideo(event.data.bitmap, event.data.timestamp)
      event.data.bitmap.close()
      const hands = result.landmarks.map((landmarks) => {
        const wrist = landmarks[0]
        const thumb = landmarks[4]
        const index = landmarks[8]
        const palmWidth = pointDistance(landmarks[5], landmarks[17]) || 1
        const pinchPoint = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
        const extendedFingers = FINGER_TIPS.reduce((count, tipIndex, i) => {
          const tip = landmarks[tipIndex]
          const pip = landmarks[FINGER_PIPS[i]]
          return pointDistance(tip, wrist) > pointDistance(pip, wrist) ? count + 1 : count
        }, 0)
        const center = {
          x: (wrist.x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
          y: (wrist.y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
        }
        return {
          pinchRatio: pointDistance(thumb, index) / palmWidth,
          pinchPoint,
          open: extendedFingers >= OPEN_HAND_MIN_EXTENDED,
          closed: extendedFingers <= CLOSED_HAND_MAX_EXTENDED,
          center,
        }
      })
      post({ type: "result", hands })
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "No se pudo procesar la cámara." })
  }
}
