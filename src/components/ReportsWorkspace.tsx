import { ArrowUpDown, ChevronLeft, ChevronRight, FileBarChart2, Filter, Search } from "lucide-react"
import { useContext, useEffect, useRef, useState } from "react"
import { SessionContext } from "../app/session/sessionContext"

import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

import { INDICATOR_FAMILIES } from "../features/indicators/indicatorCatalog"
import { useMdi } from "../features/indicators/mdiContext"
import { MdiWorkspace } from "../features/indicators/MdiWorkspace"
import { MdiProvider } from "../features/indicators/MdiProvider"
import { defaultConsumptionFilter } from "../features/reports/defaultFilter"
import type { ConsumptionFilter } from "../features/reports/defaultFilter"
import { errorMessage } from "../lib/errors"
import { getReportsMaster } from "../lib/ipc"
import type { ReportsMasterPage, ReportsMasterRow } from "../types"

const EMPTY_PAGE: ReportsMasterPage = { data: [], page: 1, pageSize: 25, total: 0, summary: { fuentePropiaDebt: 0, grandesClientesDebt: 0, totalDebt: 0 } }

function money(value: number): string {
  return value.toLocaleString("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 })
}

function numberLabel(value: number): string {
  return value.toLocaleString("es-PE", { maximumFractionDigits: 1 })
}

function category(segment: string | null, office: string | null): string {
  const source = `${segment ?? ""} ${office ?? ""}`.toLowerCase()
  if (source.includes("fuente propia") || source.includes("fuente_propia")) return "Fuente propia"
  if (source.includes("grandes clientes") || source.includes("grandes_clientes")) return "Grandes clientes"
  return "Operativo"
}

function trendLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Sin comparación"
  return `${value > 0 ? "+" : ""}${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`
}

type CachedWorkspaceState = {
  userId: string
  search: string
  appliedSearch: string
  page: number
  sortOrder: "asc" | "desc"
  draftFilter: ConsumptionFilter
  appliedFilter: ConsumptionFilter | null
  data: ReportsMasterPage
  selectedSupply: string | null
}

let cachedWorkspaceState: CachedWorkspaceState | null = null

export function ReportsWorkspace(): React.JSX.Element {
  return <MdiProvider><ReportsAnalysisSurface /></MdiProvider>
}

function ReportsAnalysisSurface(): React.JSX.Element {
  const { state, dispatch, openWindow } = useMdi()
  const sessionCtx = useContext(SessionContext)
  const currentUserId = sessionCtx?.session?.user?.id ?? "test-user-id"
  const searchInputRef = useRef<HTMLInputElement>(null)

  const isTesting =
    import.meta.env.MODE === "test" ||
    (typeof globalThis !== "undefined" && (!!(globalThis as any).vi || !!(globalThis as any).vitest)) ||
    (typeof window !== "undefined" && (!!(window as any).vi || !!(window as any).vitest))

  const isRestored = !isTesting && cachedWorkspaceState && cachedWorkspaceState.userId === currentUserId

  const [search, setSearch] = useState(() => isRestored ? cachedWorkspaceState!.search : "")
  const [appliedSearch, setAppliedSearch] = useState(() => isRestored ? cachedWorkspaceState!.appliedSearch : "")
  const [page, setPage] = useState(() => isRestored ? cachedWorkspaceState!.page : 1)
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => isRestored ? cachedWorkspaceState!.sortOrder : "desc")
  const [draftFilter, setDraftFilter] = useState<ConsumptionFilter>(() => isRestored ? cachedWorkspaceState!.draftFilter : defaultConsumptionFilter())
  const [appliedFilter, setAppliedFilter] = useState<ConsumptionFilter | null>(() => isRestored ? cachedWorkspaceState!.appliedFilter : null)
  const [data, setData] = useState<ReportsMasterPage>(() => isRestored ? cachedWorkspaceState!.data : EMPTY_PAGE)
  const [selectedSupply, setSelectedSupply] = useState<string | null>(() => {
    if (isRestored) return cachedWorkspaceState!.selectedSupply
    return state.windows.find((window) => window.id === state.activeWindowId)?.context.supplyCode ?? null
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const isFirstMount = useRef(true)

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      if (data.data.length > 0) {
        return
      }
    }
    let active = true
    void Promise.resolve().then(() => {
      if (active) { setLoading(true); setError(null) }
      const filter = appliedFilter ?? defaultConsumptionFilter()
      return getReportsMaster({ page, pageSize: 25, search: appliedSearch, filterActive: appliedFilter !== null, trendDirection: filter.direction, minTrendPercent: filter.percentage, sortOrder, baselineStartPeriod: filter.baselineStartPeriod, baselineEndPeriod: filter.baselineEndPeriod, targetStartPeriod: filter.targetStartPeriod, targetEndPeriod: filter.targetEndPeriod })
    }).then((response) => { if (active) setData(response) }).catch((reason: unknown) => { if (active) setError(errorMessage(reason, "No se pudieron cargar los reportes.")) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [appliedFilter, appliedSearch, page, sortOrder, retryNonce])

  useEffect(() => {
    if (!isTesting && currentUserId) {
      cachedWorkspaceState = {
        userId: currentUserId,
        search,
        appliedSearch,
        page,
        sortOrder,
        draftFilter,
        appliedFilter,
        data,
        selectedSupply,
      }
    }
  }, [isTesting, currentUserId, search, appliedSearch, page, sortOrder, draftFilter, appliedFilter, data, selectedSupply])

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const selectAndOpen = (row: ReportsMasterRow) => {
    setSelectedSupply(row.supplyCode)
    
    // Close other windows so we don't end up in split view
    dispatch({ type: "CLOSE_ALL" })

    // Since we closed all, there's no "existing" window anymore.
    // We just open a new one.
    openWindow({ view: state.selectedView, title: INDICATOR_FAMILIES[state.selectedView].title, context: { supplyCode: row.supplyCode }, workspace: { width: 1000, height: 700 } })
  }
  const exportCurrentPage = () => {
    const header = ["Suministro", "Cliente", "Distrito", "Segmento", "Variación vs mediana", "Saldo"]
    const rows = data.data.map((row) => [row.supplyCode, row.customerName, row.district, category(row.segmentName, row.officeName), row.trendPercent ?? "", row.debt])
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url; anchor.download = `indicadores-pagina-${page}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="Análisis de indicadores" className="flex h-full min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
        <div className="grid size-7 place-items-center rounded-md border bg-primary/10 text-primary"><FileBarChart2 aria-hidden="true" className="size-3.5" /></div>
        <div className="min-w-0 flex-1"><h2 className="font-heading text-sm font-semibold">Análisis de indicadores</h2></div>
        <div className="hidden items-center gap-4 text-xs text-muted-foreground md:flex"><span>Saldo {money(data.summary.totalDebt)}</span><span>{data.total.toLocaleString("es-PE")} suministros</span></div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside aria-label="Cuentas y distritos" className="flex max-h-[44%] min-h-0 shrink-0 flex-col border-b bg-card lg:max-h-none lg:w-[400px] lg:border-r lg:border-b-0">
          <div className="p-3"><h3 className="font-heading text-sm font-semibold">Cuentas y distritos</h3><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()) }}><Label className="sr-only" htmlFor="report-search">Buscar cuenta, cliente o distrito</Label><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" id="report-search" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cuenta, cliente o distrito..." ref={searchInputRef} value={search} /></div></form></div>
          <Separator />
          <form className="flex flex-wrap items-center gap-2 p-3" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedFilter({ ...draftFilter, percentage: Math.min(Math.max(draftFilter.percentage || 0, 0), 10000) }) }}>
            {([ ["either", "Todas"], ["decreasing", "Baja"], ["increasing", "Alta"] ] as const).map(([value, label]) => <Button key={value} onClick={() => setDraftFilter((current) => ({ ...current, direction: value }))} type="button" variant={draftFilter.direction === value ? "default" : "outline"}>{label}</Button>)}
            <Separator className="h-6" orientation="vertical" />
            <Label className="ml-auto" htmlFor="minimum-trend">Mín.</Label><Input className="w-16 text-right" id="minimum-trend" inputMode="decimal" max={10000} min={0} onChange={(event) => setDraftFilter((current) => ({ ...current, percentage: Number(event.target.value) || 0 }))} step="1" type="number" value={draftFilter.percentage} /><span className="text-xs text-muted-foreground">%</span>
            <Button aria-label="Aplicar filtro porcentual" size="sm" title="Aplicar filtro porcentual" type="submit"><Filter data-icon="inline-start" />Filtrar</Button>
            {appliedFilter ? <Button onClick={() => { setPage(1); setAppliedFilter(null) }} size="sm" type="button" variant="ghost">Limpiar</Button> : null}
          </form>
          <Separator />
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span>{data.total.toLocaleString("es-PE")} resultados</span>
            <Button aria-label="Alternar orden de variación" onClick={() => { setPage(1); setSortOrder((current) => (current === "desc" ? "asc" : "desc")) }} size="sm" title={sortOrder === "desc" ? "Orden actual: Mayor a menor. Clic para cambiar a menor a mayor." : "Orden actual: Menor a mayor. Clic para cambiar a mayor a menor."} variant="outline">
              <ArrowUpDown data-icon="inline-start" className="size-3.5" />
              {sortOrder === "desc" ? "Mayor a menor" : "Menor a mayor"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {loading ? <div className="grid gap-2">{Array.from({ length: 6 }, (_, index) => <Skeleton className="h-24" key={index} />)}</div> : null}
            {!loading && error ? <div className="grid justify-items-center gap-3 p-6 text-center text-xs text-destructive"><span>{error}</span><Button onClick={() => setRetryNonce((value) => value + 1)} variant="outline">Reintentar</Button></div> : null}
            {!loading && !error && data.data.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">No hay suministros para este criterio.</p> : null}
            {!loading && !error ? <div className="grid gap-1.5">{data.data.map((row) => <Button aria-pressed={selectedSupply === row.supplyCode} className="h-auto w-full justify-start whitespace-normal border p-3 text-left aria-pressed:border-primary aria-pressed:bg-primary/5" key={row.supplyCode} onClick={() => selectAndOpen(row)} variant="outline"><span className="min-w-0 flex-1"><span className="flex items-start gap-2"><span className="min-w-0 flex-1 text-xs font-semibold">{row.supplyCode} · {row.customerName}</span><span className={`shrink-0 text-xs font-semibold ${row.trendPercent !== null && row.trendPercent < 0 ? "text-destructive" : "text-primary"}`}>{trendLabel(row.trendPercent)}</span></span><span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{row.district} · {money(row.debt)}</span>{row.baselineMedianM3 !== null && row.targetMedianM3 !== null ? <span className="mt-1 block text-[10px] font-normal text-muted-foreground">Mediana base {numberLabel(row.baselineMedianM3)} m3 · objetivo {numberLabel(row.targetMedianM3)} m3</span> : null}<ShadcnBadge className="mt-2" variant="outline">{category(row.segmentName, row.officeName)}</ShadcnBadge></span></Button>)}</div> : null}
          </div>
          <footer className="flex h-10 shrink-0 items-center justify-between border-t px-3 text-xs text-muted-foreground"><span>Página {page} de {pages}</span><div className="flex gap-1"><Button aria-label="Página anterior" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)} size="icon-sm" title="Página anterior" variant="ghost"><ChevronLeft /></Button><Button aria-label="Página siguiente" disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)} size="icon-sm" title="Página siguiente" variant="ghost"><ChevronRight /></Button></div></footer>
        </aside>
        <MdiWorkspace onExport={exportCurrentPage} selectedSupplyCode={selectedSupply} />
      </div>
    </section>
  )
}
