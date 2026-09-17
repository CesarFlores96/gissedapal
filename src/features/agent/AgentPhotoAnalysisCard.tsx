import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { getEvidenceMedia } from "@/lib/ipc"

import type { AgentPhotoAnalysis, AgentPhotoItem } from "./types"

const thumbnailCache = new Map<string, string>()

function formatDate(value: string | null): string {
  if (!value) return "Fecha no registrada"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-PE")
}

function PhotoPreview({ photo, onExpand }: { photo: AgentPhotoItem; onExpand: () => void }): React.JSX.Element {
  const [source, setSource] = useState<string | null>(() => thumbnailCache.get(photo.mediaPath) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (source || failed) return
    let active = true
    getEvidenceMedia(photo.mediaPath, true)
      .then((next) => {
        if (!active) return
        if (thumbnailCache.size >= 40) thumbnailCache.delete(thumbnailCache.keys().next().value ?? "")
        thumbnailCache.set(photo.mediaPath, next)
        setSource(next)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [failed, photo.mediaPath, source])

  return (
    <div className="relative grid min-h-48 place-items-center overflow-hidden rounded-lg bg-muted">
      {failed ? (
        <div className="grid gap-1 text-center text-xs text-muted-foreground"><AlertTriangle className="mx-auto size-5" />No se pudo cargar la miniatura.</div>
      ) : source ? (
        <img alt={`Toma ${photo.photoIndex}`} className="max-h-72 w-full object-contain" src={source} />
      ) : <Skeleton className="min-h-48 w-full rounded-none" />}
      {source ? (
        <Button aria-label="Abrir imagen completa" className="absolute top-2 right-2 bg-background/85" onClick={onExpand} size="icon-sm" variant="outline">
          <Maximize2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

function PhotoLightbox({ photo, open, onOpenChange }: { photo: AgentPhotoItem; open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ path: string; source: string | null; failed: boolean } | null>(null)
  const source = loaded?.path === photo.mediaPath ? loaded.source : null
  const failed = loaded?.path === photo.mediaPath ? loaded.failed : false

  useEffect(() => {
    if (!open || source || failed) return
    let active = true
    getEvidenceMedia(photo.mediaPath, false)
      .then((next) => { if (active) setLoaded({ path: photo.mediaPath, source: next, failed: false }) })
      .catch(() => { if (active) setLoaded({ path: photo.mediaPath, source: null, failed: true }) })
    return () => { active = false }
  }, [failed, open, photo.mediaPath, source])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Toma {photo.photoIndex} · {photo.fileName}</DialogTitle></DialogHeader>
        <div className="grid min-h-72 place-items-center overflow-hidden rounded-lg bg-black">
          {failed ? <p className="text-sm text-white/75">No se pudo abrir la imagen completa.</p> : source ? <img alt={`Toma ${photo.photoIndex}`} className="max-h-[75vh] w-full object-contain" src={source} /> : <Skeleton className="min-h-72 w-full rounded-none" />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const DOCUMENT_LABEL: Record<AgentPhotoAnalysis["source"], string> = {
  planilla: "Planilla",
  supervision: "Supervisión",
}

export function AgentPhotoAnalysisCard({ analysis }: { analysis: AgentPhotoAnalysis }): React.JSX.Element {
  const [rawIndex, setIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const { report } = analysis
  const index = Math.min(rawIndex, Math.max(report.fotos.length - 1, 0))
  const photo = report.fotos[index]
  const move = (delta: number): void => setIndex((current) => report.fotos.length ? (current + delta + report.fotos.length) % report.fotos.length : 0)
  const documentLabel = DOCUMENT_LABEL[analysis.source]

  return (
    <section className="space-y-3 rounded-xl border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Diagnóstico de la {documentLabel} {analysis.documentId}</p>
          <p className="text-[10px] text-muted-foreground">NIS {analysis.supplyCode} · {formatDate(analysis.documentDate)}</p>
        </div>
        <ShadcnBadge variant={report.nivelCriticidad === 1 ? "destructive" : "secondary"}>Nivel {report.nivelCriticidad} — {report.descripcionNivel}</ShadcnBadge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
        <div className="rounded-md bg-muted/50 p-2"><span className="block text-muted-foreground">Fotografías</span><strong>{report.totalFotos}</strong></div>
        <div className="rounded-md bg-muted/50 p-2"><span className="block text-muted-foreground">Válidas</span><strong>{report.fotosValidas}</strong></div>
        <div className="rounded-md bg-muted/50 p-2"><span className="block text-muted-foreground">Medidor</span><strong>{report.numeroMedidor ?? "No visible"}</strong></div>
        <div className="rounded-md bg-muted/50 p-2"><span className="block text-muted-foreground">Lectura</span><strong>{report.lectura ?? "No visible"}</strong></div>
      </div>

      <div className="rounded-md border p-2.5">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Conclusión técnica consolidada</p>
        <p className="mt-1 text-xs/relaxed">{report.conclusionConsolidada}</p>
        <p className="mt-1 text-[11px] text-primary">{report.accionSugerida}</p>
      </div>

      {report.incidenciasDetectadas.length ? (
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
          {report.incidenciasDetectadas.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}

      {photo ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {report.fotos.map((item, photoIndex) => (
              <Button aria-pressed={photoIndex === index} key={item.mediaId} onClick={() => setIndex(photoIndex)} size="xs" variant={photoIndex === index ? "default" : "outline"}>
                Toma {item.photoIndex}
              </Button>
            ))}
          </div>
          <PhotoPreview key={photo.mediaId} onExpand={() => setLightboxOpen(true)} photo={photo} />
          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div><span className="text-muted-foreground">Número de medidor</span><p>{photo.numeroMedidor ?? "No visible"}</p></div>
            <div><span className="text-muted-foreground">Lectura individual</span><p>{photo.lectura ?? "No visible"}</p></div>
            <div><span className="text-muted-foreground">Estado de conexión</span><p>{photo.estadoConexion}</p></div>
            <div><span className="text-muted-foreground">Estado del medidor</span><p>{photo.estadoMedidor}</p></div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Observación visual</span><p>{photo.observacion}</p></div>
            <p className="sm:col-span-2 text-[10px] text-muted-foreground">{photo.fileName} · {formatDate(photo.capturedAt)} · Nivel {photo.criticality}</p>
            {photo.error ? <p className="sm:col-span-2 text-destructive">{photo.error}</p> : null}
          </div>
          {report.fotos.length > 1 ? (
            <div className="flex items-center justify-between">
              <Button aria-label="Toma anterior" onClick={() => move(-1)} size="icon-sm" variant="outline"><ChevronLeft /></Button>
              <span className="text-[10px] text-muted-foreground">{index + 1} de {report.fotos.length}</span>
              <Button aria-label="Toma siguiente" onClick={() => move(1)} size="icon-sm" variant="outline"><ChevronRight /></Button>
            </div>
          ) : null}
          <PhotoLightbox onOpenChange={setLightboxOpen} open={lightboxOpen} photo={photo} />
        </div>
      ) : (
        <div className="grid min-h-24 place-items-center rounded-md border border-dashed text-center text-xs text-muted-foreground"><Camera className="mb-1 size-5" />Sin fotografías para mostrar.</div>
      )}

      <p className="text-[9px] text-muted-foreground">Prompt v{analysis.promptVersion} · {analysis.cacheHits} desde caché · {analysis.analyzedNow} analizadas ahora{analysis.omittedPhotoCount ? ` · ${analysis.omittedPhotoCount} omitidas` : ""}</p>
    </section>
  )
}
