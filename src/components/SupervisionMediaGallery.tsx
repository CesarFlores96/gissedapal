import { AlertCircle, Camera, ChevronDown, ChevronLeft, ChevronRight, Maximize2, MapPin, Play } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/errors"
import { getEvidenceMedia, getEvidenceMediaParts, getSupplyEvidence, openMapsWindow } from "@/lib/ipc"
import type { SupervisionEvidenceItem, SupplyEvidence } from "@/types"
import {
  buildEvidenceGroups,
  evidenceGroupLabel,
  formatEvidenceCapturedAt,
  type EvidenceGroupMode,
} from "@/utils/supervisionEvidence"
import {
  base64ToBlob,
  cacheVideoBlob,
  captureVideoPoster,
  getCachedVideoBlob,
} from "@/utils/evidenceVideo"

/**
 * Las evidencias no cambian una vez archivadas, así que la lista se cachea por
 * suministro y las miniaturas por ruta. El tope de miniaturas evita que una
 * sesión larga del workspace MDI acumule decenas de MB de data URLs.
 */
const THUMBNAIL_CACHE_LIMIT = 120
const evidenceCache = new Map<string, SupplyEvidence>()
const evidencePending = new Map<string, Promise<SupplyEvidence>>()
const thumbnailCache = new Map<string, string>()
const thumbnailPending = new Map<string, Promise<string>>()
const videoPending = new Map<string, Promise<Blob>>()

function loadEvidence(supplyCode: string): Promise<SupplyEvidence> {
  const cached = evidenceCache.get(supplyCode)
  if (cached) return Promise.resolve(cached)
  const current = evidencePending.get(supplyCode)
  if (current) return current
  const request = getSupplyEvidence(supplyCode)
    .then((evidence) => {
      evidenceCache.set(supplyCode, evidence)
      return evidence
    })
    .finally(() => evidencePending.delete(supplyCode))
  evidencePending.set(supplyCode, request)
  return request
}

function loadThumbnail(mediaPath: string): Promise<string> {
  const cached = thumbnailCache.get(mediaPath)
  if (cached) return Promise.resolve(cached)
  const current = thumbnailPending.get(mediaPath)
  if (current) return current
  const request = getEvidenceMedia(mediaPath, true)
    .then((dataUrl) => {
      if (thumbnailCache.size >= THUMBNAIL_CACHE_LIMIT) {
        const oldest = thumbnailCache.keys().next()
        if (!oldest.done) thumbnailCache.delete(oldest.value)
      }
      thumbnailCache.set(mediaPath, dataUrl)
      return dataUrl
    })
    .finally(() => thumbnailPending.delete(mediaPath))
  thumbnailPending.set(mediaPath, request)
  return request
}

/** Descarga el video una vez y lo reparte entre la miniatura y el reproductor. */
function loadVideoBlob(mediaPath: string): Promise<Blob> {
  const cached = getCachedVideoBlob(mediaPath)
  if (cached) return Promise.resolve(cached)
  const current = videoPending.get(mediaPath)
  if (current) return current
  const request = getEvidenceMediaParts(mediaPath, false)
    .then((media) => cacheVideoBlob(mediaPath, base64ToBlob(media.base64, media.mimeType)))
    .finally(() => videoPending.delete(mediaPath))
  videoPending.set(mediaPath, request)
  return request
}

/** El servidor no puede sacar el cuadro (no hay ffmpeg), así que se saca aquí. */
function loadVideoPoster(mediaPath: string): Promise<string> {
  const cached = thumbnailCache.get(mediaPath)
  if (cached) return Promise.resolve(cached)
  const current = thumbnailPending.get(mediaPath)
  if (current) return current
  const request = loadVideoBlob(mediaPath)
    .then(captureVideoPoster)
    .then((poster) => {
      if (thumbnailCache.size >= THUMBNAIL_CACHE_LIMIT) {
        const oldest = thumbnailCache.keys().next()
        if (!oldest.done) thumbnailCache.delete(oldest.value)
      }
      thumbnailCache.set(mediaPath, poster)
      return poster
    })
    .finally(() => thumbnailPending.delete(mediaPath))
  thumbnailPending.set(mediaPath, request)
  return request
}

export function SupervisionMediaGallery({ supplyCode }: { supplyCode: string }): React.JSX.Element {
  const [evidence, setEvidence] = useState<SupplyEvidence | null>(() => evidenceCache.get(supplyCode) ?? null)
  const [loading, setLoading] = useState(!evidenceCache.has(supplyCode))
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<EvidenceGroupMode>("day")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // El estado inicial sale del caché; al cambiar de suministro los llamadores
  // remontan con `key={supplyCode}`, así que aquí no hay nada que resincronizar.
  useEffect(() => {
    let active = true
    loadEvidence(supplyCode)
      .then((next) => {
        if (!active) return
        setEvidence(next)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(errorMessage(reason, "No se pudieron cargar las evidencias."))
        setLoading(false)
      })
    return () => { active = false }
  }, [retryNonce, supplyCode])

  const groups = useMemo(() => buildEvidenceGroups(evidence?.items ?? [], mode), [evidence, mode])
  // El lightbox recorre el orden visible, no el de la respuesta.
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups])

  const toggleGroup = (key: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) {
    return (
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => <Skeleton className="aspect-square w-full" key={index} />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid min-h-48 place-items-center p-6 text-center text-destructive">
        <div>
          <AlertCircle className="mx-auto mb-2 size-5" />
          <p className="text-sm font-semibold text-foreground">No se pudieron cargar las evidencias</p>
          <p className="mt-1 max-w-md text-xs">{error}</p>
          <Button
            className="mt-3"
            onClick={() => {
              evidenceCache.delete(supplyCode)
              setError(null)
              setLoading(true)
              setRetryNonce((value) => value + 1)
            }}
            variant="outline"
          >
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  if (!ordered.length) {
    return (
      <div className="grid min-h-48 place-items-center p-6 text-center text-muted-foreground">
        <div>
          <Camera className="mx-auto mb-2 size-5" />
          <p className="text-sm font-semibold text-foreground">Sin evidencias registradas</p>
          <p className="mt-1 max-w-md text-xs">No hay fotos ni videos de supervisiones o planillas archivados para este suministro.</p>
        </div>
      </div>
    )
  }

  const totalPhotos = ordered.filter((item) => item.mediaType === "photo").length
  const totalVideos = ordered.length - totalPhotos

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <ShadcnBadge variant="secondary">{totalPhotos} fotos</ShadcnBadge>
          {totalVideos > 0 ? <ShadcnBadge variant="secondary">{totalVideos} videos</ShadcnBadge> : null}
          <ShadcnBadge variant="outline">{groups.length} {mode === "folder" ? "carpetas" : "días"}</ShadcnBadge>
        </div>
        <Tabs onValueChange={(value) => setMode(value as EvidenceGroupMode)} value={mode}>
          <TabsList variant="line">
            <TabsTrigger value="day">Por día</TabsTrigger>
            <TabsTrigger value="folder">Por carpeta</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <MediaCarousel items={ordered} onExpand={setLightboxIndex} suspended={lightboxIndex !== null} />

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <section className="rounded-lg border" key={group.key}>
            <button
              className="flex w-full flex-wrap items-center gap-2 p-2.5 text-left hover:bg-muted/50"
              onClick={() => toggleGroup(group.key)}
              type="button"
            >
              <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              <span className="text-sm font-semibold">{group.label}</span>
              <ShadcnBadge variant="secondary">{group.items.length}</ShadcnBadge>
              {group.workOrders.slice(0, 3).map((order) => <ShadcnBadge key={order} variant="outline">OS {order}</ShadcnBadge>)}
              {group.supervisors.slice(0, 2).map((supervisor) => <ShadcnBadge key={supervisor} variant="outline">{supervisor}</ShadcnBadge>)}
            </button>
            {isCollapsed ? null : (
              <div className="grid gap-2 p-2.5 pt-0 sm:grid-cols-3 lg:grid-cols-5">
                {group.items.map((item) => (
                  <EvidenceTile item={item} key={item.id} onOpen={() => setLightboxIndex(ordered.indexOf(item))} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      <EvidenceLightbox index={lightboxIndex} items={ordered} onIndexChange={setLightboxIndex} />
    </div>
  )
}

function EvidenceTile({ item, onOpen, active = false, size = "grid" }: {
  item: SupervisionEvidenceItem
  onOpen: () => void
  active?: boolean
  size?: "grid" | "strip"
}): React.JSX.Element {
  const [thumbnail, setThumbnail] = useState<string | null>(() => thumbnailCache.get(item.mediaPath) ?? null)
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLButtonElement | null>(null)

  const needsThumbnail = !thumbnail && !failed
  const isVideo = item.mediaType === "video"

  // Sólo se descarga lo que entra en pantalla. En el video eso implica traer el
  // archivo entero (es la única forma de obtener un cuadro sin ffmpeg), pero se
  // reutiliza después para reproducirlo, así que no se baja dos veces.
  useEffect(() => {
    if (!needsThumbnail) return
    const element = containerRef.current
    if (!element) return
    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      const pending = isVideo ? loadVideoPoster(item.mediaPath) : loadThumbnail(item.mediaPath)
      pending
        .then((dataUrl) => { if (active) setThumbnail(dataUrl) })
        .catch(() => { if (active) setFailed(true) })
    }, { rootMargin: "200px" })
    observer.observe(element)
    return () => { active = false; observer.disconnect() }
  }, [isVideo, item.mediaPath, needsThumbnail])

  return (
    <button
      className={`group relative aspect-square shrink-0 overflow-hidden rounded-md border bg-muted outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/30 ${size === "strip" ? "w-14" : "w-full"} ${active ? "ring-2 ring-primary" : size === "strip" ? "opacity-70 hover:opacity-100" : ""}`}
      onClick={onOpen}
      ref={containerRef}
      title={item.description ?? formatEvidenceCapturedAt(item.capturedAt)}
      type="button"
    >
      {thumbnail ? (
        <img alt={item.description ?? "Evidencia de campo"} className="size-full object-cover transition-transform group-hover:scale-105" src={thumbnail} />
      ) : failed ? (
        // El video sin cuadro no necesita aviso: la insignia de reproducción ya
        // dice qué es, y el archivo sigue abriéndose al hacer clic.
        isVideo ? null : <span className="grid size-full place-items-center text-muted-foreground"><AlertCircle className="size-5" /></span>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
      {isVideo ? (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-9 place-items-center rounded-full bg-black/45 text-white"><Play className="size-4" /></span>
        </span>
      ) : null}
      {item.source === "planilla" ? (
        <span className="absolute top-1 left-1 rounded bg-background/85 px-1 text-[10px] font-medium">Planilla</span>
      ) : null}
    </button>
  )
}

/** Carrusel embebido: vista rápida de toda la evidencia sin abrir el modal. */
function MediaCarousel({ items, suspended, onExpand }: {
  items: SupervisionEvidenceItem[]
  suspended: boolean
  onExpand: (index: number) => void
}): React.JSX.Element | null {
  const [rawIndex, setIndex] = useState(0)
  const activeThumbRef = useRef<HTMLDivElement | null>(null)

  // Si cambian los filtros y el índice queda fuera de rango, se recorta acá en
  // vez de reinicarlo en un efecto aparte, para no disparar un render extra.
  const index = items.length ? Math.min(rawIndex, items.length - 1) : 0

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
  }, [index])

  const move = useCallback((delta: number) => {
    setIndex((current) => items.length ? (current + delta + items.length) % items.length : 0)
  }, [items.length])

  // Se suspende mientras el lightbox está abierto: ambos escuchan las mismas
  // flechas y no deben moverse a la vez.
  useEffect(() => {
    if (items.length < 2 || suspended) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return
      if (event.key === "ArrowRight") move(1)
      if (event.key === "ArrowLeft") move(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [items.length, move, suspended])

  const item = items[index]
  if (!item) return null

  return (
    <div className="space-y-2 rounded-xl border bg-card p-2.5 shadow-sm">
      <div className="relative grid min-h-56 place-items-center overflow-hidden rounded-lg bg-black">
        <EvidenceMediaPane item={item} key={item.id} maxHeightClass="max-h-[45vh]" />

        {items.length > 1 ? (
          <>
            <button
              aria-label="Anterior"
              className="absolute top-1/2 left-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white outline-none transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/70"
              onClick={() => move(-1)}
              type="button"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              aria-label="Siguiente"
              className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white outline-none transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/70"
              onClick={() => move(1)}
              type="button"
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {index + 1} / {items.length}
            </span>
          </>
        ) : null}

        <button
          aria-label="Ver detalle"
          className="absolute top-2 left-2 grid size-8 place-items-center rounded-full bg-black/45 text-white outline-none transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/70"
          onClick={() => onExpand(index)}
          title="Ver detalle y ubicación"
          type="button"
        >
          <Maximize2 className="size-3.5" />
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-3 pt-8 text-white">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">
              {item.source === "planilla" ? "Planilla" : "Supervisión"}
            </span>
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">OS {item.workOrderNumber}</span>
            {item.supervisor ? (
              <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">{item.supervisor}</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs font-medium">{formatEvidenceCapturedAt(item.capturedAt)}</p>
        </div>
      </div>

      {items.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {items.map((stripItem, stripIndex) => (
            <div key={stripItem.id} ref={stripIndex === index ? activeThumbRef : undefined}>
              <EvidenceTile
                active={stripIndex === index}
                item={stripItem}
                onOpen={() => setIndex(stripIndex)}
                size="strip"
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Se remonta por `key={item.id}`, de modo que cada archivo arranca limpio. */
function EvidenceMediaPane({ item, maxHeightClass = "max-h-[70vh]" }: {
  item: SupervisionEvidenceItem
  maxHeightClass?: string
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isVideo = item.mediaType === "video"

  useEffect(() => {
    let active = true
    // La object URL del video se crea y se revoca aquí: así su vida es la de
    // este panel y nadie más puede invalidarla mientras se está reproduciendo.
    let objectUrl: string | null = null
    const pending = isVideo
      ? loadVideoBlob(item.mediaPath).then((blob) => { objectUrl = URL.createObjectURL(blob); return objectUrl })
      : getEvidenceMedia(item.mediaPath, false)
    pending
      .then((url) => {
        if (active) setSource(url)
        else if (objectUrl) URL.revokeObjectURL(objectUrl)
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, "No se pudo abrir el archivo."))
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isVideo, item.mediaPath])

  if (error) return <p className="p-6 text-center text-xs text-destructive">{error}</p>
  if (!source) return <Skeleton className="size-full rounded-none" />
  if (isVideo) return <video autoPlay className={`${maxHeightClass} w-full`} controls src={source} />
  return <img alt={item.description ?? "Evidencia de campo"} className={`${maxHeightClass} w-full object-contain`} src={source} />
}

function EvidenceLightbox({ index, items, onIndexChange }: {
  index: number | null
  items: SupervisionEvidenceItem[]
  onIndexChange: (index: number | null) => void
}): React.JSX.Element {
  const item = index === null ? null : items[index] ?? null

  const move = useCallback((delta: number) => {
    if (index === null || !items.length) return
    onIndexChange((index + delta + items.length) % items.length)
  }, [index, items.length, onIndexChange])

  useEffect(() => {
    if (index === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "ArrowRight") move(1)
      if (event.key === "ArrowLeft") move(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, move])

  return (
    <Dialog onOpenChange={(open) => { if (!open) onIndexChange(null) }} open={index !== null}>
      <DialogContent className="max-w-5xl">
        {item ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-md bg-muted">
              <EvidenceMediaPane item={item} key={item.id} />
              {items.length > 1 ? (
                <>
                  <button aria-label="Anterior" className="absolute top-1/2 left-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 hover:bg-background" onClick={() => move(-1)} type="button">
                    <ChevronLeft className="size-4" />
                  </button>
                  <button aria-label="Siguiente" className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 hover:bg-background" onClick={() => move(1)} type="button">
                    <ChevronRight className="size-4" />
                  </button>
                </>
              ) : null}
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-sm font-semibold">{formatEvidenceCapturedAt(item.capturedAt)}</p>
              <div className="flex flex-wrap gap-1.5">
                <ShadcnBadge variant="secondary">{item.source === "planilla" ? "Planilla" : "Supervisión"}</ShadcnBadge>
                <ShadcnBadge variant="outline">OS {item.workOrderNumber}</ShadcnBadge>
                {item.label ? <ShadcnBadge variant="outline">{item.label}</ShadcnBadge> : null}
              </div>
              {item.supervisor ? <p className="text-muted-foreground">Responsable: <span className="text-foreground">{item.supervisor}</span></p> : null}
              {item.description ? <p className="text-muted-foreground">{item.description}</p> : null}
              <p className="text-muted-foreground">Carpeta: <span className="text-foreground">{evidenceGroupLabel(item.folder, "folder")}</span></p>
              <p className="break-all text-muted-foreground">{item.mediaPath}</p>
              {item.latitude !== null && item.longitude !== null ? (
                <Button
                  className="w-full"
                  onClick={() => { void openMapsWindow(item.latitude as number, item.longitude as number, "satellite") }}
                  size="sm"
                  variant="outline"
                >
                  <MapPin data-icon="inline-start" />Ver ubicación de captura
                </Button>
              ) : null}
              {items.length > 1 ? <p className="text-muted-foreground">{(index ?? 0) + 1} de {items.length}</p> : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
