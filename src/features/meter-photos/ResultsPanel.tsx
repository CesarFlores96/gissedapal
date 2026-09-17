import { useEffect, useMemo, useState } from "react"
import { Layers, Image as ImageIcon, Trash2 } from "lucide-react"
import { useSession } from "@/app/session/sessionContext"
import { Button, Field } from "@/components/ui"
import { meterApi, meterError } from "./api"
import { Choice, Notice, Pager } from "./shared"
import { PhotoReportDialog, CriticalityBadge, type PhotoReport } from "./PhotoReportDialog"
import { consolidateMeterResults } from "./supplyConsolidation"
import type { CriticalityLevel, GraphFilters, MeterResult, MeterRun, Paginated, SupplyConsolidatedReport } from "./types"

function resultPhoto(row: MeterResult): PhotoReport {
  return {
    fileName: row.file_name,
    filePath: row.file_path,
    runId: row.run_id,
    error: row.error_message,
    report:
      row.status === "done"
        ? {
            numeroMedidor: row.numero_medidor ?? "No visible",
            lectura: row.lectura ?? "No visible",
            estadoConexion: row.estado_conexion ?? "No visible",
            estadoMedidor: row.estado_medidor ?? "No visible",
            observacion: row.observacion ?? "No visible",
            requiereRevision: row.requiere_revision,
          }
        : null,
  }
}

export function ResultsPanel({
  runId,
  incidence,
  filters = {},
  onRun,
}: {
  runId?: string
  incidence?: string
  filters?: GraphFilters
  onRun?: (run: MeterRun) => void
}) {
  const { isReadOnly } = useSession()
  const [runs, setRuns] = useState<Paginated<MeterRun> | null>(null)
  const [runPage, setRunPage] = useState(1)
  const [selectedRun, setSelectedRun] = useState(runId ?? "all")
  const [revision, setRevision] = useState("all")
  const [search, setSearch] = useState(filters.q ?? "")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Paginated<MeterResult> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)

  // Diálogo
  const [photo, setPhoto] = useState<PhotoReport | null>(null)
  const [supply, setSupply] = useState<SupplyConsolidatedReport | null>(null)

  // Modo de visualización: Consolidado por Suministro (predeterminado) vs Fotos Individuales
  const [viewMode, setViewMode] = useState<"supplies" | "photos">("supplies")
  const [criticalityFilter, setCriticalityFilter] = useState<string>("all")

  const [confirming, setConfirming] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const filtersKey = JSON.stringify(filters)

  useEffect(() => {
    if (incidence) return
    let current = true
    void meterApi
      .runs(runPage)
      .then((value) => { if (current) setRuns(value) })
      .catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [runPage, refresh, incidence])

  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      setBusy(true)
      setError(null)
      void meterApi
        .results({
          ...(JSON.parse(filtersKey) as GraphFilters),
          ejecucion: selectedRun === "all" ? undefined : selectedRun,
          incidencia: incidence,
          requiereRevision: revision === "all" ? filters.requiereRevision : revision === "yes",
          q: search || undefined,
          page,
          pageSize: 100,
        })
        .then((value) => { if (current) setData(value) })
        .catch((err: unknown) => { if (current) setError(meterError(err)) })
        .finally(() => { if (current) setBusy(false) })
    }, search ? 250 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [selectedRun, incidence, revision, search, page, refresh, filtersKey, filters.requiereRevision])

  async function removeRuns(target: string) {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = target === "all" ? await meterApi.deleteAllRuns() : await meterApi.deleteRun(target)
      setStatus(`${result.deleted} ejecución(es) eliminada(s). Las fotografías del disco no se modificaron.`)
      setSelectedRun("all")
      setRunPage(1)
      setPage(1)
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(meterError(err))
    } finally {
      setConfirming(null)
      setBusy(false)
    }
  }

  // Consolidar los resultados cargados por suministro
  const rows = data?.data
  const consolidatedSupplies = useMemo(() => {
    if (!rows || rows.length === 0) return []
    const all = consolidateMeterResults(rows)
    if (criticalityFilter === "all") return all
    const targetLevel = parseInt(criticalityFilter, 10) as CriticalityLevel
    return all.filter((s) => s.nivelCriticidad === targetLevel)
  }, [rows, criticalityFilter])

  const run = runs?.data.find((item) => item.id === selectedRun)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {!incidence && (
          <Choice
            label="Ejecución"
            value={selectedRun}
            onChange={(value) => { setSelectedRun(value); setPage(1) }}
            options={[
              { value: "all", label: "Todas las ejecuciones" },
              ...(runs?.data.map((item) => ({
                value: item.id,
                label: `${new Date(item.started_at).toLocaleString("es-PE")} · ${item.total_files} fotos`,
              })) ?? []),
            ]}
          />
        )}
        <Choice
          label="Nivel de criticidad"
          value={criticalityFilter}
          onChange={(value) => setCriticalityFilter(value)}
          options={[
            { value: "all", label: "Todos los niveles" },
            { value: "1", label: "Nivel 1 — Crítico" },
            { value: "2", label: "Nivel 2 — Muy deficiente" },
            { value: "3", label: "Nivel 3 — Deficiente" },
            { value: "4", label: "Nivel 4 — No concluyente" },
            { value: "5", label: "Nivel 5 — No válida" },
          ]}
        />
        <Choice
          label="Revisión"
          value={revision}
          onChange={(value) => { setRevision(value); setPage(1) }}
          options={[
            { value: "all", label: "Todas" },
            { value: "yes", label: "Con revisión" },
            { value: "no", label: "Sin revisión" },
          ]}
        />
        <Field
          label="Buscar por suministro (NIS), archivo o medidor"
          showLabel
          placeholder="Buscar NIS, archivo o medidor…"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1) }}
          wrapperClassName="min-w-48 flex-1"
        />
        <Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Actualizar
        </Button>
        {run && onRun && (
          <Button variant="outline" onClick={() => onRun(run)}>
            Exportar esta ejecución
          </Button>
        )}
        {!isReadOnly && !incidence && confirming === null && run && (
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(run.id)}>
            <Trash2 />Eliminar esta ejecución
          </Button>
        )}
        {!isReadOnly && !incidence && confirming === null && !run && Boolean(runs?.total) && (
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming("all")}>
            <Trash2 />Eliminar todas
          </Button>
        )}
        {!isReadOnly && !incidence && confirming !== null && (
          <>
            <Button variant="destructive" disabled={busy} onClick={() => { void removeRuns(confirming) }}>
              {confirming === "all" ? `Confirmar: borrar ${runs?.total ?? 0} ejecuciones` : "Confirmar borrado"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
          </>
        )}
      </div>

      {/* Selector de vista: Consolidado por Suministro vs Fotos Individuales */}
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={viewMode === "supplies" ? "default" : "outline"}
            className="gap-1.5 text-xs font-medium"
            onClick={() => setViewMode("supplies")}
          >
            <Layers className="h-3.5 w-3.5" />
            Consolidado por suministro ({consolidatedSupplies.length})
          </Button>
          <Button
            size="sm"
            variant={viewMode === "photos" ? "default" : "outline"}
            className="gap-1.5 text-xs font-medium"
            onClick={() => setViewMode("photos")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Fotografías individuales ({data?.data.length ?? 0})
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {viewMode === "supplies"
            ? "1 suministro → 1 diagnóstico consolidado → 1 nivel de criticidad"
            : "Auditoría foto por foto"}
        </p>
      </div>

      {!incidence && runs && runs.total > 20 && (
        <Pager page={runPage} size={20} total={runs.total} onPage={setRunPage} />
      )}
      {error && <Notice error>{error}</Notice>}
      {status && <Notice>{status}</Notice>}

      {busy ? (
        <Notice>Cargando resultados…</Notice>
      ) : viewMode === "supplies" ? (
        consolidatedSupplies.length ? (
          <div className="divide-y rounded-md border">
            {consolidatedSupplies.map((sup) => (
              <div key={sup.suministro} className="flex flex-wrap items-center justify-between gap-4 p-3.5 hover:bg-muted/20">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-bold text-foreground">Suministro {sup.suministro}</span>
                    <CriticalityBadge level={sup.nivelCriticidad} label={sup.descripcionNivel} />
                    <span className="text-xs text-muted-foreground">
                      {sup.totalFotos} foto(s) (V: {sup.fotosValidas}, NC: {sup.fotosNoConcluyentes}, NR: {sup.fotosNoRelacionadas})
                    </span>
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {sup.conclusionConsolidada}
                  </p>
                  <p className="text-xs">
                    <strong className="text-muted-foreground">Acción sugerida:</strong>{" "}
                    <span className="font-medium text-foreground">{sup.accionSugerida}</span>
                    {sup.numeroMedidor !== "No visible" && ` · Medidor: ${sup.numeroMedidor}`}
                    {sup.lectura !== "No visible" && ` · Lectura: ${sup.lectura}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSupply(sup)}>
                  Ver diagnóstico consolidado
                </Button>
              </div>
            ))}
          </div>
        ) : (
          !error && <Notice>No hay suministros para los filtros seleccionados.</Notice>
        )
      ) : data?.data.length ? (
        <div className="divide-y rounded-md border">
          {data.data.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={row.file_path}>
                  {row.file_name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.status === "error" ? "Error de análisis" : row.requiere_revision ? "Requiere revisión" : "Correcta"} · {row.estado_medidor}
                </p>
                {row.error_message && <p className="text-xs text-destructive">{row.error_message}</p>}
              </div>
              <span className="text-sm tabular-nums">{row.lectura ?? "No visible"}</span>
              <Button variant="outline" size="sm" onClick={() => setPhoto(resultPhoto(row))}>
                Ver fotografía
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !error && <Notice>No hay resultados para estos filtros.</Notice>
      )}

      {data && <Pager page={page} size={100} total={data.total} onPage={setPage} />}

      <PhotoReportDialog
        photo={photo}
        supply={supply}
        onClose={() => {
          setPhoto(null)
          setSupply(null)
        }}
        onReanalyzed={() => setRefresh((value) => value + 1)}
      />
    </div>
  )
}
