import { useState } from "react"
import { FolderOpen, Play, Square, RotateCcw, FileSpreadsheet, Eraser, X } from "lucide-react"
import { Button, Field } from "@/components/ui"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { meterApi, meterError } from "./api"
import { useSession } from "@/app/session/sessionContext"
import { useMeterQueue } from "./queueContext"
import { estimateRemainingMs, formatDuration } from "./queueState"
import { Notice, Pager } from "./shared"
import { PhotoReportDialog, type PhotoReport } from "./PhotoReportDialog"
import type { MeterConfigBundle } from "./types"

export function QueuePanel({ config }: { config: MeterConfigBundle | null }) {
  const { isReadOnly } = useSession()
  const queue = useMeterQueue()
  const { state, busy } = queue
  const [recursive, setRecursive] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [photo, setPhoto] = useState<PhotoReport | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const running = state.status === "running" || state.status === "cancelling"
  const rows = state.rows.filter((row) => row.fileName.toLowerCase().includes(search.toLowerCase()))
  const eta = estimateRemainingMs(state)
  const ready = config?.ollama.canDecrypt && config.activePrompt
  async function exportExcel() {
    if (!state.runId) return
    setExporting(true); setExportError(null); setExportStatus(null)
    try { const result = await meterApi.export(state.runId); if (result) setExportStatus(`Excel guardado: ${result.rowCount} fotografías. ${result.path}`) }
    catch (err) { setExportError(meterError(err)) }
    finally { setExporting(false) }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <Button size="lg" variant="outline" disabled={running || busy || state.persistErrors.length > 0} onClick={() => { setPage(1); void queue.chooseFolder(recursive) }}><FolderOpen />Seleccionar carpeta</Button>
      <Label className="gap-2 text-xs"><Checkbox checked={recursive} disabled={running || busy || state.persistErrors.length > 0} onCheckedChange={(value) => setRecursive(Boolean(value))} />Incluir subcarpetas al seleccionar</Label>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        <Button size="lg" disabled={isReadOnly || !ready || !queue.ready || !state.total || running || busy || state.persistErrors.length > 0} onClick={() => { void queue.start() }}><Play />Iniciar análisis</Button>
        {running && <Button size="lg" variant="outline" disabled={state.status === "cancelling"} onClick={() => { void queue.cancel() }}><Square />{state.status === "cancelling" ? "Cancelando…" : "Cancelar cola"}</Button>}
        {!running && state.runId && <Button size="lg" variant="outline" disabled={busy || exporting || state.counters.processed === 0 || state.persistErrors.length > 0} onClick={() => { void exportExcel() }}><FileSpreadsheet />{exporting ? "Exportando…" : "Exportar Excel"}</Button>}
        {/* Empezar de cero solo limpia esta pantalla: los resultados de la
            ejecución anterior ya quedaron guardados y siguen en Resultados. */}
        {!running && state.total > 0 && <Button size="lg" variant="ghost" disabled={busy} onClick={() => { setPage(1); setSearch(""); setExportStatus(null); setExportError(null); queue.reset() }}><Eraser />Nuevo análisis</Button>}
      </div>
    </div>
    {isReadOnly && <Notice>Modo solo consulta: cuentas con permisos para consultar y exportar resultados, pero no para iniciar análisis masivos.</Notice>}
    {/* Quien opera la cola no tiene por qué saber qué servicio de IA hay detrás
        ni manipular credenciales: si falta configuración, se le dice qué pasa y
        a quién recurrir, no cómo arreglarlo. */}
    {!isReadOnly && !ready && <Notice>El análisis automático todavía no está habilitado en esta computadora. Solicítalo al área de sistemas para poder iniciar la cola.</Notice>}
    {queue.error && <Notice error>{queue.error}</Notice>}
    {state.persistErrors.map((error) => <Notice key={error} error>{error} · Conserva esta sesión abierta y revisa la conexión antes de continuar.</Notice>)}
    {state.persistErrors.length > 0 && !running && <Button variant="outline" disabled={busy} onClick={() => { void queue.retryPersistence() }}>Reintentar guardado</Button>}{exportError && <Notice error>{exportError}</Notice>}{exportStatus && <Notice>{exportStatus}</Notice>}
    {state.folder ? <p className="break-all text-xs text-muted-foreground">{state.folder} · {state.total} imágenes compatibles · Puedes quitar las que no necesites antes de iniciar; el archivo no se borra.</p> : <Notice>Selecciona una carpeta con fotografías JPG, PNG o WebP. Verás la cantidad y los archivos antes de iniciar.</Notice>}
    {state.total > 0 && <>
      <div className="space-y-2 border-y py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums" aria-live="polite">
          <span><strong>{state.counters.processed}/{state.total}</strong> procesadas</span><span>{state.counters.pending} pendientes</span><span>{state.counters.ok} correctas</span><span>{state.counters.review} con revisión</span><span>{state.counters.error} con error</span>
        </div>
        <progress className="h-1.5 w-full accent-primary" aria-label="Progreso del análisis" max={state.total} value={state.counters.processed} />
        <p className="text-xs text-muted-foreground">{running ? `${state.concurrency === 1 ? "Procesamiento secuencial" : `${state.concurrency} fotografías en paralelo`}${eta !== null ? ` · Restante aproximado: ${formatDuration(eta)}` : ""}` : state.status === "completed" ? "Análisis finalizado" : state.status === "cancelled" ? "Cola cancelada. Los resultados obtenidos se conservan." : "Lista preparada para iniciar"}</p>
      </div>
      <Field label="Buscar archivo en la cola" placeholder="Buscar archivo…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} wrapperClassName="max-w-sm" />
      <div className="divide-y rounded-md border">
        {rows.slice((page - 1) * 50, page * 50).map((row) => <div key={row.filePath} className="flex flex-wrap items-center gap-3 p-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${row.status === "error" ? "bg-destructive" : row.status === "done" ? row.report?.requiereRevision ? "bg-amber-600" : "bg-emerald-600" : "bg-muted-foreground/40"}`} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm" title={row.filePath}>{row.fileName}</p><p className="text-xs text-muted-foreground">{{ pending: "Pendiente", running: "Analizando…", done: row.report?.requiereRevision ? "Requiere revisión" : "Correcta", error: "Error de análisis", cancelled: "Cancelada" }[row.status]}</p>{row.errorMessage && <p className="mt-1 break-words text-xs text-destructive">{row.errorMessage}</p>}</div>
          {row.report && <span className="text-sm tabular-nums">Lectura: {row.report.lectura}</span>}
          <Button variant="ghost" onClick={() => setPhoto({ fileName: row.fileName, filePath: row.filePath, report: row.report, error: row.errorMessage })}>Ver fotografía</Button>
          {row.status === "error" && <Button variant="outline" disabled={running || busy || state.persistErrors.length > 0} onClick={() => { void queue.retry(row.filePath) }}><RotateCcw />Reintentar</Button>}
          {/* Solo antes de analizar: quita la fotografía de esta cola sin
              tocar el archivo. Una vez con informe no se ofrece, para no
              confundir descartar con borrar un resultado ya obtenido. */}
          {row.status === "pending" && !running && <Button variant="ghost" disabled={busy} title="Quitar de esta cola. No borra el archivo." onClick={() => queue.exclude(row.filePath)}><X />Quitar</Button>}
        </div>)}
      </div><Pager page={page} total={rows.length} onPage={setPage} />
    </>}
    {!!queue.scan?.skipped.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{queue.scan.skipped.length} archivos omitidos</summary><ul className="mt-2 max-h-40 overflow-auto">{queue.scan.skipped.map((file, index) => <li key={index}>{file.fileName}: {file.reason}</li>)}</ul></details>}
    <PhotoReportDialog photo={photo} onClose={() => setPhoto(null)} />
  </div>
}
