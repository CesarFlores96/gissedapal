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
        pointing: boolean
        center: { x: number; y: number }
      }>
    }
  | { type: "error"; message: string }

// Índices en `landmarks` de la punta y la articulación PIP de cada uno de los
// cuatro dedos largos, en orden índice/medio/anular/meñique (se excluye el
// pulgar, cuya extensión es menos fiable con esta heurística de distancia a la
// muñeca, y no hace falta: el gesto de arrastre no depende de él).
const FINGER_TIPS = [8, 12, 16, 20]
const FINGER_PIPS = [6, 10, 14, 18]
const OPEN_HAND_MIN_EXTENDED = 3

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
        const [indexExtended, middleExtended, ringExtended, pinkyExtended] = FINGER_TIPS.map((tipIndex, i) => {
          const tip = landmarks[tipIndex]
          const pip = landmarks[FINGER_PIPS[i]]
          return pointDistance(tip, wrist) > pointDistance(pip, wrist)
        })
        const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length
        return {
          pinchRatio: pointDistance(thumb, index) / palmWidth,
          pinchPoint,
          open: extendedCount >= OPEN_HAND_MIN_EXTENDED,
          // Solo el índice extendido y los otros tres doblados: a diferencia de un
          // puño (que se confunde con un pellizco cuando el pulgar queda cerca del
          // índice), esta forma no depende del pulgar y no admite ambigüedad con
          // ningún otro gesto reconocido acá.
          pointing: indexExtended && !middleExtended && !ringExtended && !pinkyExtended,
          // El mapa sigue la punta del índice (no el centro de la palma): así el
          // arrastre se ancla donde el usuario efectivamente está apuntando.
          center: { x: index.x, y: index.y },
        }
      })
      post({ type: "result", hands })
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "No se pudo procesar la cámara." })
  }
}
