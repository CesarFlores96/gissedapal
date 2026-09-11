import { useEffect, useMemo, useState } from "react"
import { Button, Field } from "@/components/ui"
import { meterApi, meterError } from "./api"
import { Choice, Notice } from "./shared"
import { IncidenceGraphCanvas } from "./IncidenceGraphCanvas"
import { DateField } from "./DateField"
import { filterGraph } from "./incidenceGraph"
import { ResultsPanel } from "./ResultsPanel"
import type { GraphFilters, IncidenceGraph, MeterRun } from "./types"

export function GraphPanel({ runId }: { runId?: string }) {
  const [graph, setGraph] = useState<IncidenceGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("all")
  const [revision, setRevision] = useState("all")
  const [from, setFrom] = useState("")
  const [until, setUntil] = useState("")
  const [scope, setScope] = useState(runId ?? "all")
  const [runs, setRuns] = useState<MeterRun[]>([])
  const [filters, setFilters] = useState<GraphFilters>({ ejecucion: runId })
  useEffect(() => {
    // Las ejecuciones se listan desde la base, no desde la corrida que este
    // proceso tenga en memoria: si no, al recargar la aplicación el
    // desplegable quedaba con una sola opción y filtrar era imposible.
    let current = true
    void meterApi.runs(1).then((value) => { if (current) setRuns(value.data) }).catch(() => undefined)
    return () => { current = false }
  }, [])
  useEffect(() => {
    let current = true
    void meterApi.graph(filters).then((value) => { if (current) { setGraph(value); setError(null) } }).catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [filters])
  const visible = useMemo(() => {
    if (!graph) return null
    const nodes = graph.nodes.filter((node) => source === "all" || node.source === source)
    const names = new Set(nodes.map((node) => node.incidence))
    const bySource = { ...graph, nodes, edges: graph.edges.filter((edge) => names.has(edge.source_incidence) && names.has(edge.target_incidence)) }
    // Filtrado inmediato por nombre mientras se escribe, sin esperar a "Aplicar
    // filtros": da respuesta al tirón sobre lo ya cargado. La búsqueda completa
    // (lectura, número de medidor y archivo) sigue resolviéndose en el servidor
    // al aplicar, porque esos datos no están en el grafo.
    return filterGraph(bySource, query)
  }, [graph, source, query])
  function handleScopeChange(nextScope: string) {
    setScope(nextScope)
    setSelected(null)
    setGraph(null)
    setFilters((prev) => ({
      ...prev,
      ejecucion: nextScope === "all" ? undefined : nextScope,
    }))
  }
  function handleRevisionChange(nextRevision: string) {
    setRevision(nextRevision)
    setSelected(null)
    setGraph(null)
    setFilters((prev) => ({
      ...prev,
      requiereRevision: nextRevision === "all" ? undefined : nextRevision === "yes",
    }))
  }
  function apply() {
    // El selector ya garantiza el formato y el rango; esto cubre el caso de un
    // navegador sin soporte de `type="date"`, donde el campo cae a texto libre.
    if (from && until && from > until) { setError("La fecha final debe ser posterior a la inicial."); return }
    setSelected(null)
    setGraph(null)
    setFilters({ ejecucion: scope === "all" ? undefined : scope, desde: from || undefined, hasta: until ? `${until}T23:59:59.999-05:00` : undefined, requiereRevision: revision === "all" ? undefined : revision === "yes", q: query || undefined })
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <Choice label="Ejecución" value={scope} onChange={handleScopeChange} options={[{ value: "all", label: "Todas" }, ...runs.map((item) => ({ value: item.id, label: `${new Date(item.started_at).toLocaleString("es-PE")} · ${item.total_files} fotos${item.id === runId ? " · actual" : ""}` }))]} />
      <Choice label="Tipo de incidencia" value={source} onChange={setSource} options={[{ value: "all", label: "Todos" }, { value: "estado_conexion", label: "Conexión" }, { value: "estado_medidor", label: "Medidor" }, { value: "revision", label: "Revisión" }]} />
      <Choice label="Revisión" value={revision} onChange={handleRevisionChange} options={[{ value: "all", label: "Todas" }, { value: "yes", label: "Con revisión" }, { value: "no", label: "Sin revisión" }]} />
      <DateField label="Desde" value={from} onChange={setFrom} max={until || undefined} className="w-44" />
      <DateField label="Hasta" value={until} onChange={setUntil} min={from || undefined} className="w-44" />
      <Field label="Incidencia, lectura, medidor o archivo" showLabel value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply() }} wrapperClassName="min-w-48 flex-1" />
      <Button onClick={apply}>Aplicar filtros</Button>
    </div>
    {error && <Notice error>{error}</Notice>}
    {visible?.nodes.length ? <>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <IncidenceGraphCanvas graph={visible} selected={selected} onSelect={setSelected} />
        <div className="max-h-[460px] overflow-y-auto rounded-md border p-2"><p className="px-2 py-2 text-xs text-muted-foreground">{graph?.totalPhotos} fotografías · Hasta 200 incidencias principales</p>{visible.nodes.map((node) => <Button key={node.incidence} variant={selected === node.incidence ? "secondary" : "ghost"} className="h-auto min-h-10 w-full justify-between gap-3 whitespace-normal py-2 text-left" onClick={() => setSelected(node.incidence)}><span>{node.incidence}</span><span className="tabular-nums">{node.photo_count}</span></Button>)}</div>
      </div>
      {selected && <section className="space-y-3 border-t pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{selected}</h3><Button variant="ghost" onClick={() => setSelected(null)}>Cerrar lista</Button></div><ResultsPanel key={`${selected}:${JSON.stringify(filters)}`} incidence={selected} runId={filters.ejecucion ?? undefined} filters={filters} /></section>}
    </> : <Notice>{graph ? "No hay incidencias para estos filtros. Inicia un análisis o amplía la búsqueda." : "Cargando grafo…"}</Notice>}
  </div>
}
