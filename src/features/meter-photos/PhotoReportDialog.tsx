import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, AlertTriangle, HelpCircle, XCircle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { meterApi, meterError } from "./api"
import { Notice } from "./shared"
import type { CriticalityLevel, MeterReport, SupplyConsolidatedReport, SupplyPhotoItem } from "./types"

export type PhotoReport = { fileName: string; filePath: string; report: MeterReport | null; error?: string | null; runId?: string }

function PhotoAccessNotice({ error }: { error: string }) {
  const needsFolder = error.includes("no pertenece a una carpeta seleccionada")
  return <Notice error>{needsFolder ? "Para mostrar esta foto, selecciona una vez en esta sesión la carpeta que la contiene. La aplicación no conserva permisos de lectura entre sesiones." : error}</Notice>
}

export function PhotoReportDialog({
  photo,
  supply,
  onClose,
  onReanalyzed,
}: {
  photo?: PhotoReport | null
  supply?: SupplyConsolidatedReport | null
  onClose: () => void
  /** Se llama tras un reanálisis exitoso, para que el listado detrás del diálogo se refresque. */
  onReanalyzed?: () => void
}) {
  const isOpen = Boolean(photo || supply)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        {supply ? (
          <SupplyDetail supply={supply} onReanalyzed={onReanalyzed} />
        ) : photo ? (
          <>
            <DialogHeader>
              <DialogTitle>{photo.fileName}</DialogTitle>
              <DialogDescription>Fotografía original e informe del análisis individual.</DialogDescription>
            </DialogHeader>
            <PhotoDetail photo={photo} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function CriticalityBadge({ level, label }: { level: CriticalityLevel; label?: string }) {
  switch (level) {
    case 1:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          Nivel 1 — {label ?? "Crítico"}
        </span>
      )
    case 2:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-orange-500/15 px-2.5 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Nivel 2 — {label ?? "Muy deficiente"}
        </span>
      )
    case 3:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Nivel 3 — {label ?? "Deficiente / Observación"}
        </span>
      )
    case 4:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-500/15 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
          <HelpCircle className="h-3.5 w-3.5" />
          Nivel 4 — {label ?? "Imagen insuficiente"}
        </span>
      )
    case 5:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-500/15 px-2.5 py-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          <XCircle className="h-3.5 w-3.5" />
          Nivel 5 — {label ?? "No válida"}
        </span>
      )
  }
}

function SupplyDetail({ supply, onReanalyzed }: { supply: SupplyConsolidatedReport; onReanalyzed?: () => void }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const currentPhoto: SupplyPhotoItem | undefined = supply.fotos[selectedIdx] ?? supply.fotos[0]

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <DialogTitle className="text-xl">Suministro: {supply.suministro}</DialogTitle>
            <DialogDescription>Diagnóstico técnico consolidado multienfoque.</DialogDescription>
          </div>
          <CriticalityBadge level={supply.nivelCriticidad} label={supply.descripcionNivel} />
        </div>
      </DialogHeader>

      <div className="grid gap-4 rounded-lg border bg-muted/40 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-xs text-muted-foreground">Fotografías analizadas</span>
          <p className="mt-1 font-semibold">
            {supply.totalFotos} toma(s)
          </p>
          <p className="text-xs text-muted-foreground">
            Válidas: {supply.fotosValidas} · No concluyentes: {supply.fotosNoConcluyentes} · No válidas: {supply.fotosNoRelacionadas}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Medidor y lectura</span>
          <p className="mt-1 font-semibold tabular-nums">
            {supply.lectura !== "No visible" ? supply.lectura : "Lectura no visible"}
          </p>
          <p className="text-xs text-muted-foreground">
            Serie: {supply.numeroMedidor} · Encontrado: {supply.medidorEncontrado}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Acción técnica sugerida</span>
          <p className="mt-1 font-semibold text-primary">
            {supply.accionSugerida}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Nivel de criticidad</span>
          <p className="mt-1 font-semibold">
            Nivel {supply.nivelCriticidad} — {supply.descripcionNivel}
          </p>
        </div>
      </div>

      <div className="rounded-md border p-3.5 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conclusión técnica consolidada</span>
        <p className="mt-1.5 text-foreground leading-relaxed font-medium">
          {supply.conclusionConsolidada}
        </p>
      </div>

      {supply.incidenciasDetectadas.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Incidencias verificables detectadas:</span>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {supply.incidenciasDetectadas.map((inc, i) => (
              <li key={i} className="text-foreground">{inc}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Galería de fotografías asociadas */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fotografías del suministro ({supply.fotos.length} tomas)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {supply.fotos.map((f, idx) => (
              <Button
                key={f.filePath}
                size="sm"
                variant={idx === selectedIdx ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setSelectedIdx(idx)}
              >
                Toma {f.photoIndex ?? idx + 1}
              </Button>
            ))}
          </div>
        </div>

        {currentPhoto && (
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <SupplyPhotoPreview key={currentPhoto.filePath} photo={currentPhoto} />
            <dl className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 border-b pb-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Número de medidor</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{currentPhoto.numeroMedidor}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Lectura individual</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{currentPhoto.lectura}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estado de conexión en esta toma</dt>
                <dd className="mt-0.5 text-foreground">{currentPhoto.estadoConexion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estado del medidor en esta toma</dt>
                <dd className="mt-0.5 text-foreground">{currentPhoto.estadoMedidor}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Observación visual</dt>
                <dd className="mt-0.5 text-foreground">{currentPhoto.observacion}</dd>
              </div>
              <ReanalyzePhotoButton key={currentPhoto.filePath} photo={currentPhoto} onReanalyzed={onReanalyzed} />
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}

/** El reanálisis conserva la corrida anterior y abre una nueva con el prompt
 * vigente. La ruta sigue sujeta a `ensure_allowed`: la carpeta debe haber sido
 * elegida con el diálogo nativo en la sesión actual. */
function ReanalyzePhotoButton({ photo, onReanalyzed }: { photo: Pick<SupplyPhotoItem, "filePath" | "runId">; onReanalyzed?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<"ok" | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!photo.runId) return null

  return (
    <div className="space-y-1.5 border-t pt-3">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError(null)
          setResult(null)
          void meterApi
            .reanalyze(photo.runId as string, photo.filePath)
            .then(() => {
              setResult("ok")
              onReanalyzed?.()
            })
            .catch((err: unknown) => setError(meterError(err)))
            .finally(() => setBusy(false))
        }}
      >
        <RotateCcw className={busy ? "animate-spin" : undefined} />
        {busy ? "Reanalizando…" : "Reanalizar con el prompt vigente"}
      </Button>
      {result === "ok" && (
        <Notice>Se creó un nuevo análisis de esta fotografía con el prompt vigente. El resultado anterior se conserva como historial.</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  )
}

function SupplyPhotoPreview({ photo }: { photo: SupplyPhotoItem }) {
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let current = true
    void meterApi
      .photo(photo.filePath)
      .then((url) => { if (current) setImage(url) })
      .catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [photo.filePath, reload])

  return (
    <div className="space-y-2">
      {image ? (
        <img
          className="max-h-[50vh] w-full rounded-md bg-muted object-contain"
          src={image}
          alt={`Toma ${photo.fileName}`}
        />
      ) : error ? (
        <>
          <PhotoAccessNotice error={error} />
          <Button
            variant="outline"
            onClick={() => {
              void meterApi
                .pickFolder()
                .then((folder) => {
                  if (folder) {
                    setError(null)
                    setReload((v) => v + 1)
                  }
                })
                .catch((err: unknown) => setError(meterError(err)))
            }}
          >
            Seleccionar la carpeta que contiene la foto
          </Button>
        </>
      ) : (
        <Notice>Cargando fotografía…</Notice>
      )}
      <p className="break-all text-xs text-muted-foreground">{photo.fileName}</p>
    </div>
  )
}

function PhotoDetail({ photo }: { photo: PhotoReport }) {
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let current = true
    void meterApi
      .photo(photo.filePath)
      .then((url) => { if (current) setImage(url) })
      .catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [photo.filePath, reload])

  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-2">
      <div className="min-w-0 space-y-3">
        {image ? (
          <img
            className="max-h-[65vh] w-full rounded-md bg-muted object-contain"
            src={image}
            alt={`Fotografía original: ${photo.fileName}`}
          />
        ) : error ? (
          <>
            <PhotoAccessNotice error={error} />
            <Button
              variant="outline"
              onClick={() => {
                void meterApi.pickFolder().then((folder) => {
                  if (folder) {
                    setError(null)
                    setReload((value) => value + 1)
                  }
                }).catch((err: unknown) => setError(meterError(err)))
              }}
            >
              Seleccionar la carpeta que contiene la foto
            </Button>
          </>
        ) : (
          <Notice>Cargando fotografía…</Notice>
        )}
        <p className="break-all text-xs text-muted-foreground">{photo.filePath}</p>
      </div>
      <div>
        {photo.error && <Notice error>{photo.error}</Notice>}
        {photo.report ? <ReportFields report={photo.report} /> : <Notice>Esta fotografía aún no tiene un informe válido.</Notice>}
        {photo.runId && <div className="mt-4"><ReanalyzePhotoButton photo={{ filePath: photo.filePath, runId: photo.runId }} /></div>}
      </div>
    </div>
  )
}

export function ReportFields({ report }: { report: MeterReport }) {
  const details = [
    ["Estado de conexión", report.estadoConexion],
    ["Estado del medidor", report.estadoMedidor],
    ["Observación", report.observacion],
    ["Requiere revisión", report.requiereRevision ? "Sí" : "No"],
  ]
  return (
    <dl className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4 border-b pb-4">
        {[
          ["Número de medidor", report.numeroMedidor],
          ["Lectura", report.lectura],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </div>
      {details.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
