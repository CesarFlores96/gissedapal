import { CalendarDays, Download, Expand, Grid2X2, List, Shrink, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { IndicatorView } from "./IndicatorViews"
import { INDICATOR_FAMILIES } from "./indicatorCatalog"
import { useMdi } from "./mdiContext"
import type { IndicatorViewKey, MdiWindowState } from "./mdiState"

type MdiWorkspaceProps = {
  onExport: () => void
  selectedSupplyCode: string | null
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function periodOptions(): { label: string; value: string }[] {
  const now = new Date()
  const options: { label: string; value: string }[] = []
  for (let year = 2020; year <= now.getFullYear(); year += 1) {
    const lastMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12
    for (let month = 1; month <= lastMonth; month += 1) options.push({ label: `${MONTHS[month - 1]} ${year}`, value: `${year}-${String(month).padStart(2, "0")}` })
  }
  return options
}

export function MdiWorkspace({ onExport, selectedSupplyCode }: MdiWorkspaceProps): React.JSX.Element {
  const { state, dispatch, openWindow } = useMdi()
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const periods = useMemo(() => periodOptions(), [])
  const allDocuments = state.windows.filter((window) => window.mode !== "minimized")
  const documents = allDocuments.filter((window) => window.view === state.selectedView)
  const active = state.windows.find((window) => window.id === state.activeWindowId) ?? documents[0]
  const defaultStart = `${new Date().getFullYear()}-01`
  const defaultEnd = periods.at(-1)?.value ?? defaultStart

  const updatePeriod = (key: "startPeriod" | "endPeriod", value: string) => {
    const currentStart = active?.context.startPeriod ?? defaultStart
    const currentEnd = active?.context.endPeriod ?? defaultEnd
    let newStart = currentStart
    let newEnd = currentEnd
    if (key === "startPeriod") {
      newStart = value
      // If new start is after current end, advance end to match start
      if (value > currentEnd) newEnd = value
    } else {
      newEnd = value
      // If new end is before current start, rewind start to match end
      if (value < currentStart) newStart = value
    }
    for (const window of documents) {
      dispatch({ type: "SET_CONTEXT", id: window.id, context: { startPeriod: newStart, endPeriod: newEnd } })
    }
  }
  const changeFamily = (view: IndicatorViewKey) => {
    dispatch({ type: "SET_ACTIVE_VIEW", view, title: INDICATOR_FAMILIES[view].title })
    if (!selectedSupplyCode) return
    const existing = state.windows.find((window) => window.view === view && window.context.supplyCode === selectedSupplyCode)
    if (existing) {
      dispatch({ type: existing.mode === "minimized" ? "RESTORE" : "FOCUS", id: existing.id })
      return
    }
    openWindow({ view, title: INDICATOR_FAMILIES[view].title, context: { supplyCode: selectedSupplyCode, startPeriod: active?.context.startPeriod, endPeriod: active?.context.endPeriod }, workspace: { width: 1000, height: 700 } })
  }
  const expandedDocumentIsVisible = documents.some((window) => window.id === expandedId)
  const visibleDocuments = expandedId && expandedDocumentIsVisible ? documents.filter((window) => window.id === expandedId) : documents

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Tabs className="shrink-0 gap-0 border-b bg-card px-3" onValueChange={(value) => changeFamily(value as IndicatorViewKey)} value={state.selectedView}>
        <div className="flex min-h-12 items-center gap-3 overflow-x-auto">
          <p className="shrink-0 text-xs text-muted-foreground">Contexto: <span className="font-medium text-foreground">{selectedSupplyCode ?? "Sin selección"}</span></p>
          <TabsList className="h-11 min-w-max flex-1 justify-start" variant="line">
            {(Object.keys(INDICATOR_FAMILIES) as IndicatorViewKey[]).map((key) => { const item = INDICATOR_FAMILIES[key]; const Icon = item.icon; return <TabsTrigger className="h-10 px-3" key={key} value={key}><Icon data-icon="inline-start" />{item.shortTitle}</TabsTrigger> })}
          </TabsList>
        </div>
      </Tabs>

      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b bg-muted/25 px-3 py-2">
        <CalendarDays className="mb-1.5 size-4 text-primary" />
        <div className="flex items-end gap-1.5 rounded-md border bg-card px-2 py-1.5">
          <div className="grid gap-1">
            <Label htmlFor="period-start">Desde</Label>
            <NativeSelect
              className="w-36"
              id="period-start"
              onChange={(event) => updatePeriod("startPeriod", event.target.value)}
              value={active?.context.startPeriod ?? defaultStart}
            >
              {periods
                .filter((period) => period.value <= (active?.context.endPeriod ?? defaultEnd))
                .map((period) => (
                  <NativeSelectOption key={period.value} value={period.value}>{period.label}</NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
          <span className="mb-1.5 text-xs text-muted-foreground">—</span>
          <div className="grid gap-1">
            <Label htmlFor="period-end">Hasta</Label>
            <NativeSelect
              className="w-36"
              id="period-end"
              onChange={(event) => updatePeriod("endPeriod", event.target.value)}
              value={active?.context.endPeriod ?? defaultEnd}
            >
              {periods
                .filter((period) => period.value >= (active?.context.startPeriod ?? defaultStart))
                .map((period) => (
                  <NativeSelectOption key={period.value} value={period.value}>{period.label}</NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
        </div>
        <div className="ml-1 flex rounded-md border bg-card p-0.5">
          <Button aria-label="Vista en cuadrícula" onClick={() => setLayout("grid")} size="icon" title="Vista en cuadrícula" variant={layout === "grid" ? "secondary" : "ghost"}><Grid2X2 /></Button>
          <Button aria-label="Vista en lista" onClick={() => setLayout("list")} size="icon" title="Vista en lista" variant={layout === "list" ? "secondary" : "ghost"}><List /></Button>
        </div>
        <div className="ml-auto flex gap-1">
          <Button aria-label="Exportar página" onClick={onExport} size="icon" title="Exportar página" variant="outline"><Download /></Button>
        </div>
      </div>

      <Tabs className="min-h-0 flex-1 gap-0" onValueChange={(id) => dispatch({ type: "FOCUS", id })} value={state.activeWindowId ?? ""}>
        <div className="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b bg-card px-3 py-1.5">
          {documents.length === 0 ? <p className="text-xs text-muted-foreground">No hay análisis abiertos</p> : <TabsList className="h-8 min-w-max" variant="default">{documents.map((window) => <div className="flex items-center" key={window.id}><TabsTrigger className="max-w-64" value={window.id}><span className="truncate">{INDICATOR_FAMILIES[window.view].title} · {window.context.supplyCode}</span></TabsTrigger><Button aria-label={`Cerrar ${window.context.supplyCode}`} className="-ml-1" onClick={() => dispatch({ type: "CLOSE", id: window.id })} size="icon-xs" title="Cerrar análisis" variant="ghost"><X /></Button></div>)}</TabsList>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
          {documents.length === 0 ? <Card className="grid min-h-64 place-items-center border-dashed"><CardContent className="text-center"><Grid2X2 className="mx-auto mb-3 size-7 text-muted-foreground" /><CardTitle className="text-sm">Área de indicadores</CardTitle><p className="mt-1 text-xs text-muted-foreground">Seleccione una cuenta para iniciar el análisis.</p></CardContent></Card> : null}
          <div className={layout === "grid" && !expandedId && visibleDocuments.length > 1 ? "grid items-start gap-3 xl:grid-cols-2" : "grid gap-3"}>
            {allDocuments.map((window) => {
              const visible = window.view === state.selectedView && visibleDocuments.some((document) => document.id === window.id)
              return <div aria-hidden={!visible} className={visible ? "contents" : "hidden"} data-family-visible={visible} key={window.id}><IndicatorDocument expanded={expandedId === window.id} onToggleExpand={() => setExpandedId((current) => current === window.id ? null : window.id)} window={window} /></div>
            })}
          </div>
        </div>
      </Tabs>
    </div>
  )
}

function IndicatorDocument({ expanded, onToggleExpand, window }: { expanded: boolean; onToggleExpand: () => void; window: MdiWindowState }): React.JSX.Element {
  const { dispatch } = useMdi()
  const Icon = INDICATOR_FAMILIES[window.view].icon
  return (
    <section aria-label={window.title} className="overflow-hidden rounded-md border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 border-b px-3 py-2">
        <Icon className="size-4 text-primary" />
        <CardTitle className="min-w-0 flex-1 truncate text-xs">{window.title} <span className="ml-2 font-normal text-muted-foreground">{window.context.supplyCode}</span></CardTitle>
        <Button aria-label={expanded ? "Restaurar panel" : "Expandir panel"} onClick={onToggleExpand} size="icon-sm" title={expanded ? "Restaurar panel" : "Expandir panel"} variant="ghost">{expanded ? <Shrink /> : <Expand />}</Button>
        <Button aria-label="Cerrar análisis" onClick={() => dispatch({ type: "CLOSE", id: window.id })} size="icon-sm" title="Cerrar análisis" variant="ghost"><X /></Button>
      </CardHeader>
      <CardContent className="p-0"><IndicatorView context={window.context} view={window.view} /></CardContent>
    </section>
  )
}
