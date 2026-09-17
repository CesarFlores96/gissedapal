import { AlertTriangle, CheckCircle2, FileSpreadsheet, FolderKanban, Info, Loader2, Search, Upload, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button, Panel } from "@/components/ui"
import { Input } from "@/components/ui/input"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { assignItcRecord, createItcReport, getItcRecords, listItcAssignableUsers, pickAndImportItcExcel } from "@/features/informes/api"
import { RecordExplorerDialog } from "@/features/informes/RecordExplorerDialog"
import type { ItcAssignableUser, ItcRecord, ItcRecordStatus } from "@/features/informes/types"
import { ipcErrorMessage } from "@/lib/ipc"

const pageSize = 25
type NoticeKind = "success" | "error" | "info"
type Notice = { id: number; kind: NoticeKind; text: string; durationMs: number }
const NOTICE_DURATION_MS: Record<NoticeKind, number> = { success: 6_000, info: 6_000, error: 12_000 }
const NOTICE_ICON: Record<NoticeKind, typeof CheckCircle2> = { success: CheckCircle2, error: AlertTriangle, info: Info }
const NOTICE_CLASS: Record<NoticeKind, string> = {
  success: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-primary/25 bg-primary/10 text-primary",
}
let noticeSeq = 0

const statuses: Record<ItcRecordStatus, { label: string; className: string }> = {
  uploaded: { label: "Subido", className: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  queued: { label: "En cola", className: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  ready: { label: "Documentación lista", className: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "Terminado", className: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
}

function errorText(error: unknown, fallback: string): string {
  const message = ipcErrorMessage(error)
  return message && message !== "[object object]" ? message : fallback
}

function findValue(data: Record<string, unknown>, candidates: string[]): string {
  const normalizedCandidates = new Set(candidates.map(normalizeColumnLabel))
  const match = Object.entries(data).find(([key]) => normalizedCandidates.has(normalizeColumnLabel(key)))
  return match?.[1] === null || match?.[1] === undefined || match[1] === "" ? "—" : String(match[1])
}

function normalizeColumnLabel(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
}

function summarize(record: ItcRecord) {
  const supply = findValue(record.source_data, ["suministro o codigo de usuario", "suministro", "nis", "nro suministro", "nro. suministro"])
  return {
    supply,
    claimCode: findValue(record.source_data, ["codigo reclamo"]),
    claimedMonth: findValue(record.source_data, ["mes reclamado"]),
    assignee: findValue(record.source_data, ["analista", "usuario asignado", "asignado", "usuario", "responsable"]),
  }
}

function StatusBadge({ record }: { record: ItcRecord }): React.JSX.Element {
  const status = record.job_status === "processing" ? { label: "Procesando", className: statuses.queued.className } : statuses[record.status]
  return <ShadcnBadge className={status.className} variant="outline">{status.label}</ShadcnBadge>
}

function NoticeToast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }): React.JSX.Element {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(notice.durationMs / 1000))
  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((notice.durationMs - (Date.now() - startedAt)) / 1000))
      setSecondsLeft(remaining)
    }, 250)
    return () => window.clearInterval(timer)
  }, [notice.durationMs])

  const Icon = NOTICE_ICON[notice.kind]
  return (
    <div
      className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-lg backdrop-blur-sm ${NOTICE_CLASS[notice.kind]}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">{notice.text}</p>
        <p className="mt-1 text-[10px] opacity-70">Se cierra en {secondsLeft}s</p>
      </div>
      <button aria-label="Cerrar aviso" className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100" onClick={onDismiss} type="button">
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  )
}

export function InformesRoute(): React.JSX.Element {
  const [records, setRecords] = useState<ItcRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [busyRecordId, setBusyRecordId] = useState<number | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<ItcRecord | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [assignableUsers, setAssignableUsers] = useState<ItcAssignableUser[]>([])
  const [assigningRecordId, setAssigningRecordId] = useState<number | null>(null)
  const previousRecords = useRef(new Map<number, ItcRecordStatus>())

  const showNotice = useCallback((kind: NoticeKind, text: string) => {
    noticeSeq += 1
    setNotice({ id: noticeSeq, kind, text, durationMs: NOTICE_DURATION_MS[kind] })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current))
    }, notice.durationMs)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const load = useCallback(async (nextPage = page, nextSearch = search, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const payload = await getItcRecords({ page: nextPage, pageSize, search: nextSearch.trim() || undefined })
      const previous = previousRecords.current
      const completed = payload.data.find((record) => previous.get(record.id) === "queued" && record.status === "ready")
      const failed = payload.data.find((record) => previous.get(record.id) === "queued" && record.job_status === "failed")
      previousRecords.current = new Map(payload.data.map((record) => [record.id, record.status]))
      setRecords(payload.data)
      setTotal(payload.total)
      if (completed) {
        showNotice("success", `Listo: la documentación del suministro ${summarize(completed).supply} ya está lista para generar el informe.`)
      } else if (failed) {
        showNotice("error", `No se pudo completar el suministro ${summarize(failed).supply}. Vuelve a intentar "Crear informe".`)
      }
    } catch (error) {
      if (!silent) showNotice("error", errorText(error, "No se pudieron cargar los registros ITC."))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, search, showNotice])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(1, "") })
    return () => window.cancelAnimationFrame(frame)
  }, [load])

  useEffect(() => {
    // Solo el coordinador (macevedoh) o un admin pueden listar usuarios
    // asignables; para cualquier otro esto devuelve 403 y el selector de
    // asignación simplemente queda sin opciones, sin romper la pantalla.
    listItcAssignableUsers().then((result) => setAssignableUsers(result.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!records.some((record) => record.status === "queued")) return
    const timer = window.setInterval(() => { void load(page, search, true) }, 2_000)
    return () => window.clearInterval(timer)
  }, [load, page, records, search])

  const counters = useMemo(() => records.reduce<Record<ItcRecordStatus, number>>(
    (result, record) => ({ ...result, [record.status]: result[record.status] + 1 }),
    { uploaded: 0, queued: 0, ready: 0, completed: 0 },
  ), [records])

  async function importWorkbook() {
    if (importing) return
    setImporting(true)
    setNotice(null)
    try {
      const result = await pickAndImportItcExcel()
      if (!result) return
      setPage(1)
      setSearch("")
      showNotice("success", `Se importaron ${result.importedRecords} registros desde "${result.fileName}".`)
      await load(1, "")
    } catch (error) {
      showNotice("error", errorText(error, "No se pudo importar el Excel."))
    } finally {
      setImporting(false)
    }
  }

  async function queueReport(record: ItcRecord) {
    setBusyRecordId(record.id)
    const supply = summarize(record).supply
    try {
      const result = await createItcReport(record.id)
      showNotice("info", result.reused ? `El informe del suministro ${supply} ya se está preparando.` : `Informe del suministro ${supply} enviado a la cola.`)
      await load(page, search, true)
    } catch (error) {
      showNotice("error", errorText(error, `No se pudo crear el informe del suministro ${supply}.`))
    } finally {
      setBusyRecordId(null)
    }
  }

  async function assignRecord(record: ItcRecord, rawUserId: string) {
    const userId = rawUserId ? Number(rawUserId) : null
    setAssigningRecordId(record.id)
    try {
      await assignItcRecord(record.id, userId)
      const assignee = assignableUsers.find((user) => user.id === userId)
      showNotice("success", assignee ? `Suministro ${summarize(record).supply} asignado a ${assignee.full_name}.` : `Suministro ${summarize(record).supply} sin asignar.`)
      await load(page, search, true)
    } catch (error) {
      showNotice("error", errorText(error, "No se pudo asignar el registro."))
    } finally {
      setAssigningRecordId(null)
    }
  }

  if (selectedRecord) {
    const selected = summarize(selectedRecord)
    return <RecordExplorerDialog onOpenChange={(open) => { if (!open) setSelectedRecord(null) }} record={selectedRecord} reference={`Suministro ${selected.supply} · Reclamo ${selected.claimCode}`} supply={selected.supply} />
  }

  return (
    <main className="h-full min-w-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto w-full max-w-none space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary uppercase"><FolderKanban aria-hidden="true" size={15} /> Informes ITC</p>
            <h1 className="mt-1 text-lg font-semibold">Registros para informes técnicos</h1>
            <p className="mt-1 text-sm text-muted-foreground">Importa el Excel y centraliza los documentos extraídos por registro.</p>
          </div>
          <Button disabled={importing} onClick={() => { void importWorkbook() }} size="lg">
            {importing ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Upload aria-hidden="true" />}
            Importar Excel
          </Button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(statuses) as ItcRecordStatus[]).map((status) => (
            <Panel className="flex items-center justify-between p-3" key={status}>
              <div><p className="text-xs text-muted-foreground">{statuses[status].label}</p><p className="mt-1 text-xl font-semibold">{counters[status]}</p></div>
              <StatusBadge record={{ status } as ItcRecord} />
            </Panel>
          ))}
        </div>

        <Panel className="w-full overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" size={15} /><Input className="pl-8" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); void load(1, search) } }} placeholder="Buscar en registros..." value={search} /></div>
            <p className="text-xs text-muted-foreground">{total.toLocaleString("es-PE")} registros cargados</p>
          </div>
          <Table className="w-full table-fixed text-xs">
            <TableHeader><TableRow><TableHead className="w-[12%]">Suministro</TableHead><TableHead className="w-[12%]">Código reclamo</TableHead><TableHead className="w-[14%]">Mes reclamado</TableHead><TableHead className="w-[11%]">Analista</TableHead><TableHead className="w-[14%]">Origen</TableHead><TableHead className="w-[15%]">Asignado a</TableHead><TableHead className="w-[10%]">Estado</TableHead><TableHead className="w-[190px]" aria-label="Acciones" /></TableRow></TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 6 }, (_, index) => <TableRow key={index}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>) : null}
              {!loading ? records.map((record) => {
                const summary = summarize(record)
                const waiting = record.status === "queued" || record.status === "ready" || record.status === "completed"
                return <TableRow key={record.id}><TableCell className="truncate font-medium" title={summary.supply}>{summary.supply}</TableCell><TableCell className="truncate" title={summary.claimCode}>{summary.claimCode}</TableCell><TableCell className="truncate" title={summary.claimedMonth}>{summary.claimedMonth}</TableCell><TableCell className="truncate" title={summary.assignee}>{summary.assignee}</TableCell><TableCell className="truncate" title={record.original_file_name}>{record.original_file_name}</TableCell><TableCell>
                  <select
                    className="w-full rounded-md border bg-background px-1.5 py-1 text-xs disabled:opacity-50"
                    disabled={assigningRecordId === record.id}
                    onChange={(event) => { void assignRecord(record, event.target.value) }}
                    value={record.assigned_to_user_id ?? ""}
                  >
                    <option value="">Sin asignar</option>
                    {assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
                    {record.assigned_to_user_id && !assignableUsers.some((user) => user.id === record.assigned_to_user_id) ? (
                      <option value={record.assigned_to_user_id}>{record.assigned_to_full_name ?? record.assigned_to_username}</option>
                    ) : null}
                  </select>
                </TableCell><TableCell><StatusBadge record={record} />{record.job_status === "failed" ? <p className="mt-1 truncate text-[10px] text-destructive">Reintenta la creación.</p> : null}</TableCell><TableCell><div className="flex justify-end gap-2"><Button onClick={() => setSelectedRecord(record)} size="sm" variant="outline">Abrir</Button><Button disabled={waiting || busyRecordId === record.id} onClick={() => { void queueReport(record) }} size="sm">{busyRecordId === record.id ? "Enviando" : record.status === "queued" ? "En cola" : record.status === "ready" ? "Documentación lista" : record.status === "completed" ? "Informe terminado" : "Crear informe"}</Button></div></TableCell></TableRow>
              }) : null}
            </TableBody>
          </Table>
          {!loading && records.length === 0 ? <div className="px-4 py-12 text-center"><FileSpreadsheet aria-hidden="true" className="mx-auto text-muted-foreground" size={28} /><p className="mt-3 text-sm font-medium">Aún no hay registros ITC</p><p className="mt-1 text-xs text-muted-foreground">Importa un Excel para iniciar la gestión documental.</p></div> : null}
          <div className="flex justify-end gap-2 border-t p-3"><Button disabled={loading || page === 1} onClick={() => { const next = page - 1; setPage(next); void load(next) }} variant="outline">Anterior</Button><Button disabled={loading || page * pageSize >= total} onClick={() => { const next = page + 1; setPage(next); void load(next) }} variant="outline">Siguiente</Button></div>
        </Panel>
      </div>

      {notice ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <NoticeToast key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      ) : null}
    </main>
  )
}
