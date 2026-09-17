import { AlertTriangle, ArrowLeft, CheckCircle2, Download, File, FileImage, FilePlus2, FileText, Folder, HardDrive, LayoutGrid, List, Loader2, Trash2, Upload, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Badge, Button, Panel } from "@/components/ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ipcErrorMessage } from "@/lib/ipc"

import { deleteItcAsset, exportItcRecordZip, exportItcReportDocx, getItcAssetData, listItcFolderAssets, pickAndUploadItcAsset } from "./api"
import type { ItcAsset, ItcFolder, ItcRecord } from "./types"

type Props = {
  record: ItcRecord | null
  reference: string
  supply: string
  onOpenChange: (open: boolean) => void
}

function errorText(error: unknown, fallback: string): string {
  const message = ipcErrorMessage(error)
  return message && message !== "[object object]" ? message : fallback
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage
  if (contentType === "application/pdf") return FileText
  return File
}

function AssetPreviewDialog({ asset, recordId, onOpenChange }: { asset: ItcAsset; recordId: number; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getItcAssetData(recordId, asset.id)
      .then((result) => { if (!cancelled) setDataUrl(`data:${result.mimeType};base64,${result.base64}`) })
      .catch((err) => { if (!cancelled) setError(errorText(err, "No se pudo cargar el archivo.")) })
    return () => { cancelled = true }
  }, [recordId, asset.id])

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.original_file_name}</DialogTitle>
          <DialogDescription>{formatBytes(asset.byte_size)} · {asset.content_type}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] min-h-[240px] items-center justify-center overflow-auto rounded-md border bg-muted/20 p-2">
          {error ? <p className="p-6 text-sm text-destructive">{error}</p> : null}
          {!error && !dataUrl ? <Loader2 aria-hidden="true" className="animate-spin text-muted-foreground" size={28} /> : null}
          {!error && dataUrl && asset.content_type.startsWith("image/") ? <img alt={asset.original_file_name} className="max-h-[60vh] max-w-full object-contain" src={dataUrl} /> : null}
          {!error && dataUrl && asset.content_type === "application/pdf" ? <iframe className="h-[60vh] w-full rounded" src={dataUrl} title={asset.original_file_name} /> : null}
          {!error && dataUrl && !asset.content_type.startsWith("image/") && asset.content_type !== "application/pdf" ? <p className="p-6 text-sm text-muted-foreground">No hay vista previa para este tipo de archivo.</p> : null}
        </div>
        {dataUrl ? <a className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline" download={asset.original_file_name} href={dataUrl}><Download aria-hidden="true" size={14} /> Guardar una copia</a> : null}
      </DialogContent>
    </Dialog>
  )
}

function DeleteConfirmDialog({ asset, onCancel, onConfirm, deleting }: { asset: ItcAsset; onCancel: () => void; onConfirm: () => void; deleting: boolean }): React.JSX.Element {
  return (
    <Dialog onOpenChange={(open) => { if (!open) onCancel() }} open>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className="text-destructive" size={18} /> Eliminar archivo</DialogTitle>
          <DialogDescription>
            Se borrará <strong className="text-foreground">{asset.original_file_name}</strong> de forma permanente. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button disabled={deleting} onClick={onCancel} variant="outline">Cancelar</Button>
          <Button disabled={deleting} onClick={onConfirm} variant="destructive">{deleting ? <Loader2 aria-hidden="true" className="animate-spin" size={14} /> : <Trash2 aria-hidden="true" size={14} />}Eliminar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderView({ recordId, folder, onBack, onCountChange }: { recordId: number; folder: ItcFolder; onBack: () => void; onCountChange: (folderId: number, count: number) => void }): React.JSX.Element {
  const [assets, setAssets] = useState<ItcAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<ItcAsset | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ItcAsset | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<"details" | "thumbnails">("details")
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const requestedThumbnails = useRef(new Set<number>())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listItcFolderAssets(recordId, folder.id)
      setAssets(result.data)
      onCountChange(folder.id, result.data.length)
    } catch (err) {
      setError(errorText(err, "No se pudieron cargar los archivos de la carpeta."))
    } finally {
      setLoading(false)
    }
  }, [recordId, folder.id, onCountChange])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load() })
    return () => window.cancelAnimationFrame(frame)
  }, [load])

  useEffect(() => {
    if (viewMode !== "thumbnails") return
    const pending = assets.filter((asset) => asset.content_type.startsWith("image/") && !requestedThumbnails.current.has(asset.id))
    for (const asset of pending) {
      requestedThumbnails.current.add(asset.id)
      getItcAssetData(recordId, asset.id)
        .then((result) => setThumbnails((current) => ({ ...current, [asset.id]: `data:${result.mimeType};base64,${result.base64}` })))
        .catch(() => { requestedThumbnails.current.delete(asset.id) })
    }
  }, [viewMode, assets, recordId])

  async function upload() {
    if (uploading) return
    setUploading(true)
    setError(null)
    try {
      const result = await pickAndUploadItcAsset(recordId, folder.id)
      if (result) await load()
    } catch (err) {
      setError(errorText(err, "No se pudo subir el archivo."))
    } finally {
      setUploading(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteItcAsset(recordId, pendingDelete.id)
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError(errorText(err, "No se pudo eliminar el archivo."))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button aria-label="Volver a carpetas" onClick={onBack} size="icon" variant="outline"><ArrowLeft size={16} /></Button>
          <div><h2 className="font-semibold">{folder.label}</h2><p className="text-sm text-muted-foreground">{assets.length} {assets.length === 1 ? "archivo" : "archivos"}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5">
            <Button aria-label="Vista de detalles" aria-pressed={viewMode === "details"} className={viewMode === "details" ? "bg-muted" : ""} onClick={() => setViewMode("details")} size="icon-xs" variant="ghost"><List aria-hidden="true" size={14} /></Button>
            <Button aria-label="Vista de miniaturas" aria-pressed={viewMode === "thumbnails"} className={viewMode === "thumbnails" ? "bg-muted" : ""} onClick={() => setViewMode("thumbnails")} size="icon-xs" variant="ghost"><LayoutGrid aria-hidden="true" size={14} /></Button>
          </div>
          <Button disabled={uploading} onClick={() => { void upload() }} size="sm">
            {uploading ? <Loader2 aria-hidden="true" className="animate-spin" size={14} /> : <Upload aria-hidden="true" size={14} />}
            Subir archivo
          </Button>
        </div>
      </div>

      {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      {loading ? <div className="grid gap-2">{Array.from({ length: 3 }, (_, index) => <Skeleton className="h-12 w-full" key={index} />)}</div> : null}

      {!loading && assets.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Esta carpeta todavía no tiene archivos.</div>
      ) : null}

      {!loading && assets.length > 0 && viewMode === "details" ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {assets.map((asset) => {
            const Icon = fileIcon(asset.content_type)
            return (
              <div className="group flex items-center gap-3 rounded-md border bg-card p-3" key={asset.id}>
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPreviewAsset(asset)} type="button">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Icon aria-hidden="true" size={16} /></span>
                  <span className="min-w-0"><p className="truncate text-sm font-medium" title={asset.original_file_name}>{asset.original_file_name}</p><p className="text-xs text-muted-foreground">{formatBytes(asset.byte_size)}</p></span>
                </button>
                <Button aria-label={`Eliminar ${asset.original_file_name}`} className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setPendingDelete(asset)} size="icon-xs" variant="ghost"><Trash2 aria-hidden="true" size={14} /></Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {!loading && assets.length > 0 && viewMode === "thumbnails" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {assets.map((asset) => {
            const isImage = asset.content_type.startsWith("image/")
            const thumbnail = thumbnails[asset.id]
            const Icon = fileIcon(asset.content_type)
            return (
              <div className="group relative overflow-hidden rounded-md border bg-card" key={asset.id}>
                <button className="flex w-full flex-col text-left" onClick={() => setPreviewAsset(asset)} type="button">
                  <span className="flex aspect-square items-center justify-center bg-muted/40">
                    {isImage && thumbnail ? <img alt={asset.original_file_name} className="size-full object-cover" src={thumbnail} /> : null}
                    {isImage && !thumbnail ? <Loader2 aria-hidden="true" className="animate-spin text-muted-foreground" size={20} /> : null}
                    {!isImage ? <Icon aria-hidden="true" className="text-muted-foreground" size={32} /> : null}
                  </span>
                  <span className="p-2"><p className="truncate text-xs font-medium" title={asset.original_file_name}>{asset.original_file_name}</p><p className="text-[10px] text-muted-foreground">{formatBytes(asset.byte_size)}</p></span>
                </button>
                <Button aria-label={`Eliminar ${asset.original_file_name}`} className="absolute top-1 right-1 bg-background/80 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" onClick={() => setPendingDelete(asset)} size="icon-xs" variant="ghost"><Trash2 aria-hidden="true" size={13} /></Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {previewAsset ? <AssetPreviewDialog asset={previewAsset} key={previewAsset.id} onOpenChange={(open) => { if (!open) setPreviewAsset(null) }} recordId={recordId} /> : null}
      {pendingDelete ? <DeleteConfirmDialog asset={pendingDelete} deleting={deleting} onCancel={() => setPendingDelete(null)} onConfirm={() => { void confirmDelete() }} /> : null}
    </>
  )
}

export function RecordExplorerDialog({ record, reference, supply, onOpenChange }: Props): React.JSX.Element {
  const [selectedFolder, setSelectedFolder] = useState<ItcFolder | null>(null)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [exporting, setExporting] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [exportNotice, setExportNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const handleCountChange = useCallback((folderId: number, count: number) => {
    setCounts((current) => (current[folderId] === count ? current : { ...current, [folderId]: count }))
  }, [])

  useEffect(() => {
    if (!exportNotice) return
    const timeout = window.setTimeout(() => setExportNotice(null), 6_000)
    return () => window.clearTimeout(timeout)
  }, [exportNotice])

  if (!record) return <></>
  const folders = record.folders.map((folder) => ({ ...folder, assetCount: counts[folder.id] ?? folder.assetCount }))
  const fileCount = folders.reduce((total, folder) => total + folder.assetCount, 0)

  async function exportZip() {
    if (exporting || !record) return
    setExporting(true)
    setExportNotice(null)
    try {
      const suggested = `informe_${supply.replace(/[^A-Za-z0-9._-]+/g, "_") || "suministro"}.zip`
      const savedPath = await exportItcRecordZip(record.id, suggested)
      if (savedPath) setExportNotice({ kind: "success", text: `Se guardó el .zip en ${savedPath}.` })
    } catch (err) {
      setExportNotice({ kind: "error", text: errorText(err, "No se pudo generar el .zip.") })
    } finally {
      setExporting(false)
    }
  }

  async function generateReport() {
    if (generatingReport || !record) return
    setGeneratingReport(true)
    setExportNotice(null)
    try {
      const suggested = `informe_${supply.replace(/[^A-Za-z0-9._-]+/g, "_") || "suministro"}.docx`
      const savedPath = await exportItcReportDocx(record.id, suggested)
      if (savedPath) setExportNotice({ kind: "success", text: `Se guardó el Word en ${savedPath}.` })
    } catch (err) {
      setExportNotice({ kind: "error", text: errorText(err, "No se pudo generar el informe.") })
    } finally {
      setGeneratingReport(false)
    }
  }

  return <main className="h-full min-w-0 overflow-y-auto bg-background p-4 sm:p-6">
    <div className="mx-auto w-full max-w-none">
      <Panel className="overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-3"><Button aria-label="Volver a informes" onClick={() => onOpenChange(false)} size="icon" variant="outline"><ArrowLeft size={16} /></Button><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Explorador documental</p><h1 className="truncate text-lg font-semibold">{reference}</h1><p className="text-sm text-muted-foreground">Archivos y fotografías obtenidos desde AGC.</p></div></div>
          <div className="flex items-center gap-2">
            <Badge>{fileCount} archivos</Badge>
            <Button disabled={generatingReport} onClick={() => { void generateReport() }} size="sm" variant="outline">
              {generatingReport ? <Loader2 aria-hidden="true" className="animate-spin" size={14} /> : <FilePlus2 aria-hidden="true" size={14} />}
              Generar informe (Word)
            </Button>
            <Button disabled={exporting || fileCount === 0} onClick={() => { void exportZip() }} size="sm" variant="outline">
              {exporting ? <Loader2 aria-hidden="true" className="animate-spin" size={14} /> : <Download aria-hidden="true" size={14} />}
              Descargar todo (.zip)
            </Button>
          </div>
        </header>
        <div className="border-b bg-muted/30 px-4 py-2 text-sm text-muted-foreground"><HardDrive className="mr-2 inline size-4 text-primary" />Este equipo / Informes ITC{selectedFolder ? ` / ${selectedFolder.label}` : ""}</div>
        <div className="grid min-h-[420px] lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b bg-muted/20 p-3 lg:border-r lg:border-b-0">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carpetas</p>
            {folders.map((folder) => (
              <button
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${selectedFolder?.id === folder.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60"}`}
                key={folder.id}
                onClick={() => setSelectedFolder(folder)}
                type="button"
              >
                <Folder size={16} /><span className="min-w-0 flex-1 truncate">{folder.label}</span><span className="text-xs">{folder.assetCount}</span>
              </button>
            ))}
          </aside>
          <section className="p-4">
            {selectedFolder ? (
              <FolderView
                folder={selectedFolder}
                onBack={() => setSelectedFolder(null)}
                onCountChange={handleCountChange}
                recordId={record.id}
              />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Archivos y fotografías</h2><p className="text-sm text-muted-foreground">Documentación agrupada por fuente AGC.</p></div><span className="text-sm text-muted-foreground">{fileCount} elementos</span></div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {folders.map((folder) => (
                    <button className="rounded-md border bg-card p-4 text-left transition-colors hover:border-primary/40" key={folder.id} onClick={() => setSelectedFolder(folder)} type="button">
                      <div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary"><Folder size={19} /></span><Badge>{folder.assetCount} archivos</Badge></div>
                      <p className="mt-4 text-sm font-medium">{folder.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{folder.assetCount ? "Documentación disponible." : "Pendiente de la extracción."}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </Panel>
    </div>

    {exportNotice ? (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <div className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-lg ${exportNotice.kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`} role={exportNotice.kind === "error" ? "alert" : "status"}>
          {exportNotice.kind === "error" ? <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} /> : <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0" size={16} />}
          <p className="min-w-0 flex-1 leading-snug">{exportNotice.text}</p>
          <button aria-label="Cerrar aviso" className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100" onClick={() => setExportNotice(null)} type="button"><X aria-hidden="true" size={14} /></button>
        </div>
      </div>
    ) : null}
  </main>
}
