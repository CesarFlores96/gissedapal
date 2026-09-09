import { CheckCircle2, Hand, LoaderCircle, VideoOff, X } from "lucide-react"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "../../components/ui"
import { useMapInteraction } from "../map/mapInteractionContext"
import { createGestureTracker, updateGestureTracker, type GestureTracker } from "./gestureMath"

type GestureStatus = "idle" | "starting" | "ready" | "active" | "error"

function statusText(status: GestureStatus, disabled: boolean): string {
  if (disabled) return "Pausado durante el ajuste catastral"
  if (status === "starting") return "Preparando cámara…"
  if (status === "active") return "Control activo"
  if (status === "ready") return "Pinza con ambas manos para zoom, o cierra el puño para mover el mapa"
  if (status === "error") return "No se pudo activar la cámara"
  return "Control por manos apagado"
}

// Convierte el desplazamiento normalizado del centro de la palma (fracción del
// ancho/alto del cuadro de la cámara) en píxeles de paneo del mapa.
const PAN_PIXELS_PER_UNIT = 1000

export function GestureControlPanel({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const { mapReady, zoomBy, panBy } = useMapInteraction()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GestureStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const workerReadyRef = useRef(false)
  const frameRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  const processingRef = useRef(false)
  const lastFrameAtRef = useRef(0)
  const trackerRef = useRef<GestureTracker>(createGestureTracker())
  const disabledRef = useRef(disabled)
  const zoomByRef = useRef(zoomBy)
  const panByRef = useRef(panBy)

  useEffect(() => { disabledRef.current = disabled }, [disabled])
  useEffect(() => { zoomByRef.current = zoomBy }, [zoomBy])
  useEffect(() => { panByRef.current = panBy }, [panBy])

  const stop = useCallback((): void => {
    activeRef.current = false
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    workerRef.current?.postMessage({ type: "dispose" })
    workerRef.current?.terminate()
    workerRef.current = null
    workerReadyRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    processingRef.current = false
    trackerRef.current = createGestureTracker()
    setStatus("idle")
  }, [])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (!disabled || !open) return
    const timer = window.setTimeout(() => {
      stop()
      setOpen(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [disabled, open, stop])

  const start = useCallback(async (): Promise<void> => {
    if (disabled || activeRef.current) return
    setError(null)
    setStatus("starting")
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unavailable")
      if (!mapReady) throw new Error("map-not-ready")

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error("video-unavailable")
      video.srcObject = stream
      await video.play()

      const worker = new Worker(new URL("./handLandmarker.worker.ts", import.meta.url), { type: "module" })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<{
        type: "ready" | "result" | "error"
        hands?: Array<{
          pinchRatio: number
          pinchPoint: { x: number; y: number }
          open: boolean
          closed: boolean
          center: { x: number; y: number }
        }>
        message?: string
      }>) => {
        if (event.data.type === "ready") {
          workerReadyRef.current = true
          setStatus("ready")
          return
        }
        if (event.data.type === "error") {
          stop()
          setError(event.data.message
            ? `La cámara no pudo procesar el movimiento de las manos (${event.data.message}).`
            : "La cámara no pudo procesar el movimiento de las manos.")
          setStatus("error")
          return
        }
        processingRef.current = false
        const update = updateGestureTracker(trackerRef.current, { hands: event.data.hands ?? [] })
        setStatus(update.active ? "active" : update.ready ? "ready" : "starting")
        if (!disabledRef.current) {
          if (update.zoomDelta !== 0) zoomByRef.current(update.zoomDelta)
          if (update.panDelta.dx !== 0 || update.panDelta.dy !== 0) {
            // `map.panBy(offset)` mueve el CENTRO de cámara en la dirección de `offset`
            // (no el contenido) — para lograr el efecto de "arrastrar" el mapa, donde
            // el contenido sigue visualmente a la mano, hay que pasarle el offset
            // invertido respecto al movimiento visible de la mano.
            // El video se muestra en espejo (-scale-x-100) pero los landmarks llegan
            // en el espacio sin espejar de la cámara, así que en X ambas inversiones
            // (espejo + arrastre) se cancelan y se usa el valor crudo; en Y no hay
            // espejo, así que solo se invierte para el efecto de arrastre.
            panByRef.current(update.panDelta.dx * PAN_PIXELS_PER_UNIT, -update.panDelta.dy * PAN_PIXELS_PER_UNIT)
          }
        }
      }
      worker.onerror = () => {
        stop()
        setError("No se pudo cargar el control por manos.")
        setStatus("error")
      }
      worker.postMessage({ type: "init", modelPath: "/models/hand_landmarker.task" })
      activeRef.current = true

      const renderLoop = (timestamp: number): void => {
        if (!activeRef.current) return
        frameRef.current = requestAnimationFrame(renderLoop)
        if (!workerReadyRef.current || timestamp - lastFrameAtRef.current < 1000 / 15 || processingRef.current || video.readyState < 2) return
        lastFrameAtRef.current = timestamp
        processingRef.current = true
        void createImageBitmap(video).then((bitmap) => {
          if (!activeRef.current || !workerRef.current) {
            bitmap.close()
            processingRef.current = false
            return
          }
          workerRef.current.postMessage({ type: "detect", bitmap, timestamp }, [bitmap])
        }).catch(() => { processingRef.current = false })
      }
      frameRef.current = requestAnimationFrame(renderLoop)
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Permite el acceso a la cámara para usar este control."
        : "No se encontró una cámara compatible en este equipo.")
      setStatus("error")
    }
  }, [disabled, mapReady, stop])

  function toggle(): void {
    if (open) {
      stop()
      setOpen(false)
      return
    }
    setOpen(true)
    void start()
  }

  return (
    <>
      <Button
        aria-expanded={open}
        aria-pressed={open}
        disabled={disabled}
        onClick={toggle}
        size="lg"
        title={disabled ? "Pausado durante el ajuste catastral" : "Controlar el zoom con las manos"}
        variant={open ? "accent" : "outline"}
      >
        <Hand aria-hidden="true" size={15} strokeWidth={1.75} />
        Manos
      </Button>

      {open ? createPortal(
        <section
          aria-label="Control del mapa mediante gestos"
          className="fixed right-3 top-14 z-50 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${status === "active" ? "bg-emerald-500" : status === "error" ? "bg-destructive" : "bg-muted-foreground/50"}`} />
              <div>
                <h2 className="text-xs font-semibold">Zoom por gestos</h2>
                <p className="text-[10px] text-muted-foreground">La cámara permanece en este equipo</p>
              </div>
            </div>
            <Button aria-label="Cerrar control por manos" onClick={toggle} size="icon-sm" variant="ghost"><X aria-hidden="true" /></Button>
          </div>

          <div className="relative aspect-video bg-slate-950">
            <video ref={videoRef} autoPlay className="h-full w-full -scale-x-100 object-cover" muted playsInline />
            {status === "starting" ? <div className="absolute inset-0 grid place-items-center bg-slate-950/60 text-xs text-white"><LoaderCircle className="mr-1 inline size-4 animate-spin" /> Preparando…</div> : null}
            {status === "error" ? <div className="absolute inset-0 grid place-items-center gap-1 bg-slate-950/75 px-5 text-center text-xs text-white"><VideoOff className="size-5" />{error}</div> : null}
          </div>

          <div className="space-y-2 px-3 py-3 text-[11px]">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2">
              {status === "active" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <Hand className="mt-0.5 size-3.5 shrink-0 text-primary" />}
              <span>{statusText(status, disabled)}</span>
            </div>
            <p className="text-muted-foreground">Separa las pinzas para acercar y júntalas para alejar.</p>
            <p className="text-muted-foreground">Cierra el puño y muévelo para arrastrar el mapa; ábrela para soltarlo.</p>
          </div>
        </section>,
        document.body,
      ) : null}
    </>
  )
}
