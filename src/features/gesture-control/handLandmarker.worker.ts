import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision"

type WorkerRequest =
  | { type: "init"; modelPath: string }
  | { type: "detect"; bitmap: ImageBitmap; timestamp: number }
  | { type: "dispose" }

type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; hands: Array<{ pinchRatio: number; pinchPoint: { x: number; y: number } }> }
  | { type: "error"; message: string }

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
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm")
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
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
        const thumb = landmarks[4]
        const index = landmarks[8]
        const palmWidth = pointDistance(landmarks[5], landmarks[17]) || 1
        const pinchPoint = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
        return { pinchRatio: pointDistance(thumb, index) / palmWidth, pinchPoint }
      })
      post({ type: "result", hands })
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "No se pudo procesar la cámara." })
  }
}
