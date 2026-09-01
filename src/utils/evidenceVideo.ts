/**
 * Video de evidencia en el escritorio.
 *
 * Dos cosas que el video necesita y la foto no:
 *
 * 1. **Object URL en vez de data URL.** El webview no puede buscar dentro de un
 *    `data:` de video, así que el `<video>` se queda en blanco. Se guarda el
 *    `Blob` (no la URL) y cada consumidor crea y revoca la suya, de modo que la
 *    vida de la object URL sea local y nadie revoque la de otro.
 * 2. **Miniatura calculada aquí.** El servidor no tiene ffmpeg, así que el
 *    primer cuadro se extrae en el cliente con un `<canvas>`.
 */

/** Los videos de campo pesan; se retienen pocos y el resto se vuelve a pedir. */
const VIDEO_CACHE_LIMIT = 12
const POSTER_BOX = 480
/** El cuadro 0 suele salir negro: se busca un poco más adelante. */
const POSTER_SEEK_SECONDS = 0.5
const POSTER_TIMEOUT_MS = 8000

const videoBlobCache = new Map<string, Blob>()

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  // El ArrayBuffer explícito fija el tipo del búfer: `new Uint8Array(n)` se
  // infiere como ArrayBufferLike y no encaja en un BlobPart.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mimeType })
}

export function getCachedVideoBlob(mediaPath: string): Blob | undefined {
  return videoBlobCache.get(mediaPath)
}

export function cacheVideoBlob(mediaPath: string, blob: Blob): Blob {
  if (videoBlobCache.size >= VIDEO_CACHE_LIMIT) {
    const oldest = videoBlobCache.keys().next()
    if (!oldest.done) videoBlobCache.delete(oldest.value)
  }
  videoBlobCache.set(mediaPath, blob)
  return blob
}

/**
 * Primer cuadro utilizable del video, como data URL JPEG.
 *
 * Se resuelve con `onseeked` porque `loadeddata` puede llegar antes de que el
 * cuadro esté dibujable; el temporizador cubre los formatos que el webview
 * carga pero no deja buscar.
 */
export function captureVideoPoster(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const video = document.createElement("video")
    let settled = false

    const finish = (result: string | null): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(objectUrl)
      if (result) resolve(result)
      else reject(new Error("No se pudo extraer un cuadro del video."))
    }

    const draw = (): void => {
      if (!video.videoWidth || !video.videoHeight) return finish(null)
      const scale = Math.min(1, POSTER_BOX / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const context = canvas.getContext("2d")
      if (!context) return finish(null)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL("image/jpeg", 0.75))
    }

    const timer = window.setTimeout(() => { if (video.readyState >= 2) draw(); else finish(null) }, POSTER_TIMEOUT_MS)

    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    video.onerror = () => finish(null)
    video.onseeked = draw
    video.onloadeddata = () => {
      const target = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(POSTER_SEEK_SECONDS, video.duration / 2)
        : 0
      // Si ya está en el cuadro pedido no habrá `seeked`: se dibuja directo.
      if (Math.abs(video.currentTime - target) < 0.01) draw()
      else video.currentTime = target
    }
    video.src = objectUrl
  })
}
