import { Activity, AlertCircle, ArrowDownToLine, ArrowUpFromLine, Calendar, CheckCircle2, ChartNoAxesCombined, ClipboardList, Clock, Database, Droplet, FileCheck, FilterX, Gauge, Map as MapIcon, MapPin, Percent, ReceiptText, Search, Sigma, Tag, TriangleAlert, TrendingUp, Wrench } from "lucide-react"
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import type { FeatureCollection, Geometry } from "geojson"

import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { getSupplyReport } from "../../lib/ipc"
import { errorMessage } from "../../lib/errors"
import type { ReportEvolutionRow, SupplyReport } from "../../types"
import type { IndicatorContext, IndicatorViewKey } from "./mdiState"

type IndicatorMetric = { label: string; value: string | null; detail?: string; action?: "block-map" | "details" }
type IndicatorDefinition = { label: string; calculate: (report: SupplyReport, rows: ReportEvolutionRow[]) => IndicatorMetric }

const unavailable = (label: string): IndicatorMetric => ({ label, value: null })
const number = (value: number | null | undefined, digits = 1): string | null => value == null || !Number.isFinite(value) ? null : value.toLocaleString("es-PE", { maximumFractionDigits: digits })
const volume = (value: number | null | undefined): string | null => { const result = number(value); return result === null ? null : `${result} m3` }
const percent = (value: number | null | undefined): string | null => { const result = number(value); return result === null ? null : `${value && value > 0 ? "+" : ""}${result}%` }
const money = (value: number | null | undefined): string | null => value == null || !Number.isFinite(value) ? null : value.toLocaleString("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 })
const ratio = (value: number | null | undefined, unit: string): string | null => { const result = number(value, 2); return result === null ? null : `${result} ${unit}` }
const chartConfig = {
  consumption: { label: "Consumo", color: "var(--chart-2)" },
  expected: { label: "Esperado", color: "var(--chart-1)" },
} satisfies ChartConfig

const EMPTY_DETAILS: SupplyReport["details"] = { stateReadings: [], meterInstallations: [], workOrders: [], billing: [], anomalies: [], inspections: [] }

function isWithinPeriod(value: string | null | undefined, start?: string, end?: string): boolean {
  if (!value) return true
  const period = value.slice(0, 7)
  return (!start || period >= start) && (!end || period <= end)
}

function periodRows(report: SupplyReport, startPeriod?: string, endPeriod?: string): ReportEvolutionRow[] {
  const latestYear = Math.max(...report.years)
  const start = startPeriod ?? `${latestYear}-01`
  return Object.values(report.analysisByYear)
    .flatMap((year) => year.evolutionRows)
    .filter((row) => row.currentVolume !== null)
    .filter((row) => {
      const period = `${row.year}-${String(row.month).padStart(2, "0")}`
      return period >= start && (!endPeriod || period <= endPeriod)
    })
    .sort((a, b) => a.year - b.year || a.month - b.month)
}

function definitions(view: IndicatorViewKey): IndicatorDefinition[] {
  const common = {
    latest: (_report: SupplyReport, rows: ReportEvolutionRow[]) => rows.at(-1),
    values: (_report: SupplyReport, rows: ReportEvolutionRow[]) => rows.map((row) => row.currentVolume).filter((value): value is number => value !== null),
  }
  if (view === "consumption") return [
    { label: "Consumo mensual", calculate: (r, rows) => ({ label: "Consumo mensual", value: volume(common.latest(r, rows)?.currentVolume), detail: common.latest(r, rows)?.label }) },
    { label: "Consumo acumulado del periodo", calculate: (_r, rows) => ({ label: "Consumo acumulado del periodo", value: volume(rows.reduce((sum, row) => sum + (row.currentVolume ?? 0), 0)) }) },
    { label: "Promedio mensual (6 meses)", calculate: (r, rows) => { const values = common.values(r, rows).slice(-6); return { label: "Promedio mensual (6 meses)", value: values.length ? volume(values.reduce((sum, value) => sum + value, 0) / values.length) : null } } },
    { label: "Maximo historico", calculate: (r) => { const values = Object.values(r.analysisByYear).flatMap((year) => year.evolutionRows).map((row) => row.currentVolume).filter((value): value is number => value !== null); return { label: "Maximo historico", value: values.length ? volume(Math.max(...values)) : null } } },
    { label: "Minimo historico", calculate: (r) => { const values = Object.values(r.analysisByYear).flatMap((year) => year.evolutionRows).map((row) => row.currentVolume).filter((value): value is number => value !== null); return { label: "Minimo historico", value: values.length ? volume(Math.min(...values)) : null } } },
    { label: "Variacion mensual", calculate: (r, rows) => { const last = common.latest(r, rows); const previous = rows.at(-2)?.currentVolume; const value = last?.currentVolume != null && previous != null && previous !== 0 ? ((last.currentVolume - previous) / previous) * 100 : null; return { label: "Variacion mensual", value: percent(value) } } },
    { label: "Tendencia de consumo", calculate: (r, rows) => { const last = common.latest(r, rows); return { label: "Tendencia de consumo", value: last?.isAnomaly ? last.type : (last ? "Estable" : null), detail: percent(last?.variationVsMedianPercent) ?? undefined } } },
    { label: "Consumo acumulado", calculate: (r, rows) => ({ label: "Consumo acumulado", value: volume(common.values(r, rows).reduce((sum, value) => sum + value, 0)) }) },
  ]
  if (view === "risk") return [
    { label: "Consumo cero o bajo", calculate: (r, rows) => { const last = common.latest(r, rows); return { label: "Consumo cero o bajo", value: last ? (last.currentVolume === 0 || last.type.toLowerCase().includes("bajo") ? "Detectado" : "No detectado") : null } } },
    { label: "Consumo alto", calculate: (r, rows) => { const last = common.latest(r, rows); return { label: "Consumo alto", value: last ? (last.type.toLowerCase().includes("alto") ? "Detectado" : "No detectado") : null } } },
    { label: "Cambio abrupto", calculate: (r, rows) => { const last = common.latest(r, rows); return { label: "Cambio abrupto", value: last?.isAnomaly ? "Detectado" : (last ? "No detectado" : null), detail: percent(last?.variationVsMedianPercent) ?? undefined } } },
    { label: "Diferencia con vecinos", calculate: (r) => ({ label: "Diferencia con vecinos", value: percent(r.indicators.spatial.neighborDeviationPercent), detail: r.indicators.spatial.neighborCount ? `${r.indicators.spatial.neighborCount} suministros en 250 m` : undefined }) },
    { label: "Lote grande con bajo uso", calculate: (r) => ({ label: "Lote grande con bajo uso", value: r.indicators.spatial.lotAreaM2 && r.indicators.spatial.consumptionPerM2 != null ? (r.indicators.spatial.lotAreaM2 >= 500 && r.indicators.spatial.consumptionPerM2 < 0.05 ? "Detectado" : "No detectado") : null, detail: "Regla: lote >= 500 m2 y consumo < 0.05 m3/m2" }) },
    { label: "Lote pequeno con alto uso", calculate: (r) => ({ label: "Lote pequeno con alto uso", value: r.indicators.spatial.lotAreaM2 && r.indicators.spatial.consumptionPerM2 != null ? (r.indicators.spatial.lotAreaM2 <= 120 && r.indicators.spatial.consumptionPerM2 > 1 ? "Detectado" : "No detectado") : null, detail: "Regla: lote <= 120 m2 y consumo > 1 m3/m2" }) },
    { label: "Indice de riesgo comercial", calculate: (r, rows) => { const latest = common.latest(r, rows); const anomaly = latest?.isAnomaly ? 35 : 0; const operational = Math.min((r.indicators.operations.openAnomalyCount ?? 0) * 15, 30); const debt = r.header.debt > 0 ? 20 : 0; const neighbors = Math.min(Math.abs(r.indicators.spatial.neighborDeviationPercent ?? 0) / 10, 15); return { label: "Indice de riesgo comercial", value: `${Math.round(anomaly + operational + debt + neighbors)}/100`, detail: "Regla trazable: consumo, anomalías, deuda y entorno" } } },
  ]
  if (view === "predictive") return [
    { label: "Consumo esperado", calculate: (r, rows) => ({ label: "Consumo esperado", value: volume(common.latest(r, rows)?.historicalMedian) }) },
    { label: "Deteccion de anomalias", calculate: (r, rows) => { const last = common.latest(r, rows); return { label: "Deteccion de anomalias", value: last ? (last.isAnomaly ? last.type : "Sin anomalia") : null } } },
    { label: "Clasificacion automatica", calculate: (r) => ({ label: "Clasificacion automatica", value: r.header.classification || null }) },
    { label: "Recomendacion de inspeccion", calculate: (r, rows) => { const year = r.analysisByYear[String(rows.at(-1)?.year ?? Math.max(...r.years))]; const open = r.indicators.operations.openAnomalyCount ?? 0; return { label: "Recomendacion de inspeccion", value: open > 0 || year?.analysis.severity === "critical" || year?.analysis.severity === "probable" ? "Revisar suministro" : (year ? "Sin prioridad" : null), detail: open > 0 ? `${open} anomalías operativas abiertas` : year?.analysis.reasons[0] } } },
    ...["Probabilidad de submedicion", "Probabilidad de fuga"].map((label) => ({ label, calculate: () => unavailable(label) })),
  ]
  if (view === "economic") return [
    { label: "Saldo pendiente", calculate: (r) => ({ label: "Saldo pendiente", value: money(r.header.debt) }) },
    { label: "Facturacion mensual", calculate: (r) => ({ label: "Facturacion mensual", value: money(r.indicators.economic.monthlyBillingSoles) }) },
    { label: "Facturacion anual", calculate: (r) => ({ label: "Facturacion anual", value: money(r.indicators.economic.annualBillingSoles), detail: r.indicators.economic.latestYear ? String(r.indicators.economic.latestYear) : undefined }) },
    { label: "Ingreso por m2", calculate: (r) => { const amount = r.indicators.economic.monthlyBillingSoles; const area = r.indicators.spatial.lotAreaM2; return { label: "Ingreso por m2", value: amount != null && area ? money(amount / area) : null } } },
    { label: "Ingreso por distrito", calculate: (r) => ({ label: "Ingreso por distrito", value: money(r.indicators.spatial.districtBillingSoles), detail: r.indicators.spatial.periodYear ? `${r.indicators.spatial.periodMonth}/${r.indicators.spatial.periodYear}` : undefined }) },
    { label: "Ticket promedio", calculate: (r) => ({ label: "Ticket promedio", value: money(r.indicators.economic.averageTicketSoles), detail: "Promedio de hasta 12 períodos" }) },
  ]
  if (view === "spatial") return [
    { label: "Consumo por m2", calculate: (r) => ({ label: "Consumo por m2", value: ratio(r.indicators.spatial.consumptionPerM2, "m3/m2"), detail: r.indicators.spatial.lotSupplyCount ? `Lote: ${r.indicators.spatial.lotSupplyCount} suministros · suministro actual ${ratio(r.indicators.spatial.currentSupplyConsumptionPerM2, "m3/m2") ?? "sin consumo"}` : undefined }) },
    { label: "Consumo por metro lineal", calculate: (r) => ({ label: "Consumo por metro lineal", value: ratio(r.indicators.spatial.blockConsumptionPerLinearMeter, "m3/m"), detail: r.indicators.spatial.consumptionPerLinearMeter != null ? `Lote ${ratio(r.indicators.spatial.consumptionPerLinearMeter, "m3/m")} · suministro ${ratio(r.indicators.spatial.currentSupplyConsumptionPerLinearMeter, "m3/m") ?? "sin consumo"}` : undefined }) },
    { label: "Densidad de consumo", calculate: (r) => { const total = volume(r.indicators.spatial.blockConsumptionM3); return { label: "Densidad de consumo", value: ratio((r.indicators.spatial.blockConsumptionDensityM3PerM2 ?? 0) * 1000, "kg/m2"), detail: total && r.indicators.spatial.blockLotAreaM2 ? `${(r.indicators.spatial.blockConsumptionM3 ?? 0) * 1000} kg / ${number(r.indicators.spatial.blockLotAreaM2)} m2 de lotes` : undefined } } },
    { label: "Consumo por manzana", calculate: (r) => { const lotTotal = volume(r.indicators.spatial.lotConsumptionM3); const current = volume(r.indicators.spatial.currentConsumptionM3); return { label: "Consumo por manzana", value: volume(r.indicators.spatial.blockConsumptionM3), detail: r.indicators.spatial.blockSupplyCount ? `${r.indicators.spatial.blockSupplyCount} suministros${lotTotal ? ` · lote ${lotTotal}` : ""}${current ? ` · suministro ${current}` : ""}` : undefined, action: "block-map" } } },
    { label: "Consumo por distrito", calculate: (r) => ({ label: "Consumo por distrito", value: volume(r.indicators.spatial.districtConsumptionM3), detail: r.indicators.spatial.districtSupplyCount ? `${r.indicators.spatial.districtSupplyCount} suministros` : undefined }) },
    { label: "Promedio de vecinos", calculate: (r) => ({ label: "Promedio de vecinos", value: volume(r.indicators.spatial.neighborAverageM3), detail: r.indicators.spatial.neighborCount ? `${r.indicators.spatial.neighborCount} suministros en 250 m` : undefined }) },
  ]
  if (view === "comparative") return [
    { label: "Ranking de consumo", calculate: (r) => ({ label: "Ranking de consumo", value: r.indicators.spatial.districtRank ? `${r.indicators.spatial.districtRank} de ${r.indicators.spatial.districtSupplyCount}` : null, detail: "Dentro del distrito", action: "details" }) },
    { label: "Ranking por m2", calculate: (r) => ({ label: "Ranking por m2", value: r.indicators.spatial.districtPerAreaRank ? `${r.indicators.spatial.districtPerAreaRank} de ${r.indicators.spatial.districtPerAreaSupplyCount}` : null, detail: "Intensidad m3/m2 dentro del distrito", action: "details" }) },
    { label: "Comparacion distrital", calculate: (r) => ({ label: "Comparacion distrital", value: percent(r.indicators.spatial.districtAverageM3 ? ((r.indicators.spatial.currentConsumptionM3 ?? 0) - r.indicators.spatial.districtAverageM3) / r.indicators.spatial.districtAverageM3 * 100 : null), detail: "Frente al promedio distrital" }) },
    { label: "Comparacion por manzana", calculate: (r) => ({ label: "Comparacion por manzana", value: percent(r.indicators.spatial.blockAverageM3 ? ((r.indicators.spatial.currentConsumptionM3 ?? 0) - r.indicators.spatial.blockAverageM3) / r.indicators.spatial.blockAverageM3 * 100 : null) }) },
    { label: "Comparacion de lotes similares", calculate: (r) => { const avg = r.indicators.spatial.similarLotsAverageM3; const current = r.indicators.spatial.currentConsumptionM3; return { label: "Comparacion de lotes similares", value: percent(avg ? ((current ?? 0) - avg) / avg * 100 : null), detail: r.indicators.spatial.similarLotsCount ? `${r.indicators.spatial.similarLotsCount} lotes de area y actividad similar` : "Sin lotes comparables por area/actividad", action: "details" } } },
    { label: "Percentil de consumo", calculate: (r) => ({ label: "Percentil de consumo", value: percent(r.indicators.spatial.consumptionPercentile), detail: "Percentil dentro del distrito" }) },
    { label: "Área del predio", calculate: (r) => ({ label: "Área del predio", value: ratio(r.indicators.spatial.lotAreaM2, "m2") }) },
    { label: "Perímetro del predio", calculate: (r) => ({ label: "Perímetro del predio", value: ratio(r.indicators.spatial.lotPerimeterM, "m") }) },
  ]
  if (view === "efficiency") return [
    { label: "m3 por m2", calculate: (r) => ({ label: "m3 por m2", value: ratio(r.indicators.spatial.consumptionPerM2, "m3/m2") }) },
    { label: "Consumo por metro de conexion", calculate: (r) => ({ label: "Consumo por metro de conexion", value: ratio(r.indicators.spatial.consumptionPerLinearMeter, "m3/m") }) },
    { label: "Consumo por conexion", calculate: (r) => ({ label: "Consumo por conexion", value: volume(r.indicators.spatial.currentConsumptionM3), detail: "Una conexión asociada al suministro" }) },
    { label: "Indice de aprovechamiento de agua", calculate: (_r, rows) => { const latest = common.latest(_r, rows); return { label: "Indice de aprovechamiento de agua", value: percent(latest?.historicalMedian ? (latest.currentVolume ?? 0) / latest.historicalMedian * 100 : null), detail: "Consumo real / consumo esperado" } } },
  ]
  return [
    { label: "Consumo inteligente", calculate: (r, rows) => { const latest = common.latest(r, rows); const deviation = Math.abs(latest?.variationVsMedianPercent ?? 0); return { label: "Consumo inteligente", value: latest ? `${Math.round(Math.max(0, 100 - Math.min(deviation, 100)))}/100` : null, detail: "Estabilidad frente a la mediana histórica" } } },
    { label: "Indice de similitud", calculate: (r) => ({ label: "Indice de similitud", value: r.indicators.spatial.neighborDeviationPercent != null ? `${Math.round(Math.max(0, 100 - Math.min(Math.abs(r.indicators.spatial.neighborDeviationPercent), 100)))}/100` : null, detail: "Similitud con vecinos a 250 m" }) },
    { label: "Oportunidad comercial", calculate: (r) => { const deviation = r.indicators.spatial.neighborDeviationPercent; const value = deviation == null ? null : deviation < -40 || r.header.debt > 0 ? "Alta" : deviation < -20 ? "Media" : "Baja"; return { label: "Oportunidad comercial", value, detail: "Regla: brecha de consumo y saldo" } } },
    { label: "Nivel de confianza", calculate: (r) => { const flags = Object.values(r.indicators.coverage ?? {}); const available = flags.filter(Boolean).length; const score = flags.length ? available / flags.length * 100 : null; return { label: "Nivel de confianza", value: percent(score), detail: flags.length ? `${available} de ${flags.length} fuentes disponibles` : undefined } } },
  ]
}

const reportCache = new Map<string, SupplyReport>()
const pendingReports = new Map<string, Promise<SupplyReport>>()
function requestReport(supplyCode: string): Promise<SupplyReport> {
  const cached = reportCache.get(supplyCode)
  if (cached) return Promise.resolve(cached)
  const pending = pendingReports.get(supplyCode)
  if (pending) return pending
  const request = getSupplyReport(supplyCode).then((report) => { reportCache.set(supplyCode, report); return report }).finally(() => pendingReports.delete(supplyCode))
  pendingReports.set(supplyCode, request)
  return request
}

export function IndicatorView({ context, view }: { context: IndicatorContext; view: IndicatorViewKey }): React.JSX.Element {
  const { supplyCode } = context
  const [report, setReport] = useState<Partial<SupplyReport> | null>(() => supplyCode ? reportCache.get(supplyCode) ?? null : null)
  const [loading, setLoading] = useState(Boolean(supplyCode && !report))
  const [error, setError] = useState<string | null>(null)
  const [detailSearch, setDetailSearch] = useState("")
  const [blockMapOpen, setBlockMapOpen] = useState(false)
  const [blockMapLoading, setBlockMapLoading] = useState(false)
  const [blockMapError, setBlockMapError] = useState<string | null>(null)
  const [selectedComparativeMetric, setSelectedComparativeMetric] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!supplyCode) return
    let active = true

    const fetchProgressively = async () => {
      try {
        if (active) {
          setLoading(true)
          setError(null)
          setReport(null)
        }

        const api = await import("../../lib/ipc")
        const header = await api.getSupplyReportHeader(supplyCode)
        if (!active) return
        setReport({ supplyCode, header })
        setLoading(false)

        try {
          const indicators = await api.getSupplyReportSpatial(supplyCode)
          if (!active) return
          setReport((current) => current ? { ...current, indicators } : current)
        } catch {
          // El resto de bloques no depende de los indicadores espaciales.
        }

        try {
          const details = await api.getSupplyReportDetails(supplyCode)
          if (!active) return
          setReport((current) => current ? { ...current, details } : current)
        } catch {
          // El análisis temporal debe continuar aunque falte un detalle operativo.
        }

        try {
          const temporal = await api.getSupplyReportTemporal(supplyCode)
          if (!active) return
          setReport((current) => {
            const complete = current ? { ...current, ...temporal } : current
            if (complete?.header && complete.indicators && complete.details && complete.analysisByYear) {
              reportCache.set(supplyCode, complete as SupplyReport)
            }
            return complete
          })
        } catch {
          // La información ya cargada permanece disponible mientras termina la secuencia.
        }
      } catch (reason: unknown) {
        if (active) setError(errorMessage(reason, "No se pudieron cargar los indicadores."))
        if (active) setLoading(false)
      }
    }

    void fetchProgressively()
    return () => { active = false }
  }, [retryNonce, supplyCode])

  const rows = useMemo(() => report && report.analysisByYear ? periodRows(report as SupplyReport, context.startPeriod, context.endPeriod) : [], [context.endPeriod, context.startPeriod, report])
  const metrics = useMemo(() => report?.indicators && report.analysisByYear ? definitions(view).map((definition) => definition.calculate(report as SupplyReport, rows)) : [], [report, rows, view])
  const chartData = useMemo(() => rows.map((row) => ({ label: `${row.label.slice(0, 3)} ${String(row.year).slice(-2)}`, consumption: row.currentVolume, expected: row.historicalMedian })), [rows])
  const details = useMemo(() => {
    const source = report?.details ?? EMPTY_DETAILS
    const start = context.startPeriod
    const end = context.endPeriod
    return {
      stateReadings: (source.stateReadings ?? []).filter((row) => isWithinPeriod(row.readingDate, start, end)),
      meterInstallations: (source.meterInstallations ?? []).filter((row) => isWithinPeriod(row.installationDate ?? row.processDate, start, end)),
      workOrders: (source.workOrders ?? []).filter((row) => isWithinPeriod(row.scheduledDate ?? row.completedAt, start, end)),
      billing: (source.billing ?? []).filter((row) => isWithinPeriod(`${row.period_year}-${String(row.period_month).padStart(2, "0")}`, start, end)),
      anomalies: (source.anomalies ?? []).filter((row) => isWithinPeriod(row.detectedAt, start, end)),
      inspections: (source.inspections ?? []).filter((row) => isWithinPeriod(row.visitDate ?? row.inspectionDate, start, end)),
    }
  }, [context.endPeriod, context.startPeriod, report])

  const [activeInnerTab, setActiveInnerTab] = useState("indicators")
  const [mountedInnerTabs, setMountedInnerTabs] = useState<Set<string>>(new Set(["indicators"]))

  const handleInnerTabChange = (value: string) => {
    setActiveInnerTab(value)
    setMountedInnerTabs((prev) => {
      if (prev.has(value)) return prev
      const next = new Set(prev)
      next.add(value)
      return next
    })
  }

  useEffect(() => {
    if (view !== "consumption") return
    const allTabs = ["indicators", "evolution", "readings", "meters", "orders", "billing", "anomalies", "cadastre"]
    const timer = window.setInterval(() => {
      setMountedInnerTabs((prev) => {
        if (prev.size === allTabs.length) {
          clearInterval(timer)
          return prev
        }
        const next = new Set(prev)
        for (const tab of allTabs) {
          if (!next.has(tab)) {
            next.add(tab)
            break
          }
        }
        return next
      })
    }, 300)
    return () => clearInterval(timer)
  }, [view])

  if (!supplyCode) return <EmptyState title="Seleccione un suministro" detail="El contexto se elige desde el listado de clientes." />
  if (loading) return <div className="grid gap-3 p-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-56 sm:col-span-3" /></div>
  if (error) return <EmptyState action={<Button className="mt-3" onClick={() => setRetryNonce((value) => value + 1)} variant="outline">Reintentar</Button>} title="No se pudieron cargar los indicadores" detail={error} tone="danger" />
  if (!report?.header) return <EmptyState title="Sin datos disponibles" detail="No existe informacion de cabecera para este suministro." />
  
  const showBlockMap = (): void => {
    setBlockMapOpen(true)
    setBlockMapError(null)
    const spatial = report?.indicators?.spatial
    if (spatial?.blockGeometry && spatial?.blockLots?.length) return
    if (report.supplyCode) reportCache.delete(report.supplyCode)
    setBlockMapLoading(true)
    if (report.supplyCode) {
      void requestReport(report.supplyCode)
        .then((updated) => setReport(updated))
        .catch((reason: unknown) => setBlockMapError(errorMessage(reason, "No se pudo actualizar la geometría de la manzana.")))
        .finally(() => setBlockMapLoading(false))
    }
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><CardDescription>Suministro {report.supplyCode}</CardDescription><CardTitle className="mt-1 text-sm">{report.header.customerName || "Cliente sin nombre"}</CardTitle><div className="mt-2 flex flex-wrap gap-1.5"><ShadcnBadge variant="secondary">{report.header.classification}</ShadcnBadge><ShadcnBadge variant="outline">{report.header.payerClassification}</ShadcnBadge><ShadcnBadge variant="outline">{report.header.serviceStatus}</ShadcnBadge><ShadcnBadge variant={report.header.debt > 0 ? "destructive" : "outline"}>Saldo {money(report.header.debt)}</ShadcnBadge></div></div>
        <ShadcnBadge variant="outline">{report.header.district || "Distrito no disponible"}</ShadcnBadge>
      </div>
      {view !== "consumption" ? (
        <>
          {report.indicators && report.analysisByYear ? <MetricGrid metrics={metrics} onShowBlock={showBlockMap} onSelectMetric={setSelectedComparativeMetric} /> : <Skeleton className="h-64 w-full" />}
          {view === "comparative" && selectedComparativeMetric && report.indicators && report.analysisByYear ? <ComparativeDetails label={selectedComparativeMetric} report={report as SupplyReport} /> : null}
          {report.indicators && report.analysisByYear ? <BlockLotsDialog error={blockMapError} loading={blockMapLoading} onOpenChange={setBlockMapOpen} onRetry={showBlockMap} open={blockMapOpen} report={report as SupplyReport} /> : null}
        </>
      ) : <Tabs onValueChange={handleInnerTabChange} value={activeInnerTab}>
        <div className="overflow-x-auto border-b"><TabsList className="min-w-max" variant="line">
          <TabsTrigger value="indicators"><Gauge data-icon="inline-start" />Indicadores</TabsTrigger>
          <TabsTrigger value="evolution"><Activity data-icon="inline-start" />Evolución Volumen</TabsTrigger>
          <TabsTrigger value="readings"><Search data-icon="inline-start" />Toma de Estado</TabsTrigger>
          <TabsTrigger value="meters"><Wrench data-icon="inline-start" />Instalación de Medidores</TabsTrigger>
          <TabsTrigger value="orders"><ClipboardList data-icon="inline-start" />Órdenes</TabsTrigger>
          <TabsTrigger value="billing"><ReceiptText data-icon="inline-start" />Facturación</TabsTrigger>
          <TabsTrigger value="anomalies"><TriangleAlert data-icon="inline-start" />Anomalías</TabsTrigger>
          <TabsTrigger value="cadastre"><MapPin data-icon="inline-start" />Catastro</TabsTrigger>
        </TabsList></div>
        <TabsContent className="mt-2" value="indicators">
          {mountedInnerTabs.has("indicators") && report.indicators && report.analysisByYear ? <><MetricGrid metrics={metrics} /><ConsumptionChart data={chartData} compact /></> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="evolution">
          {mountedInnerTabs.has("evolution") && report.analysisByYear ? <ConsumptionTable rows={rows} /> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="readings">
          {mountedInnerTabs.has("readings") && report.details ? <><DetailFilter onChange={setDetailSearch} value={detailSearch} /><StateReadingsTable rows={filterDetailRows(details.stateReadings, detailSearch)} /></> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="meters">
          {mountedInnerTabs.has("meters") && report.details ? <><DetailFilter onChange={setDetailSearch} value={detailSearch} /><MeterInstallationsTable rows={filterDetailRows(details.meterInstallations, detailSearch)} /></> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="orders">
          {mountedInnerTabs.has("orders") && report.details ? <><DetailFilter onChange={setDetailSearch} value={detailSearch} /><OrdersView inspections={details.inspections} search={detailSearch} workOrders={details.workOrders} /></> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="billing">
          {mountedInnerTabs.has("billing") && report.details ? <BillingView rows={details.billing} /> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="anomalies">
          {mountedInnerTabs.has("anomalies") && report.details ? <><DetailFilter onChange={setDetailSearch} value={detailSearch} /><AnomaliesTable rows={filterDetailRows(details.anomalies, detailSearch)} /></> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
        <TabsContent className="mt-2" value="cadastre">
          {mountedInnerTabs.has("cadastre") && report.indicators ? <CadastreView report={report as SupplyReport} /> : <Skeleton className="h-64 w-full" />}
        </TabsContent>
      </Tabs>}
    </div>
  )
}

const metricIcons = [Droplet, Sigma, TrendingUp, ArrowUpFromLine, ArrowDownToLine, Percent, ChartNoAxesCombined, Database]

function MetricGrid({ metrics, onShowBlock, onSelectMetric }: { metrics: IndicatorMetric[]; onShowBlock?: () => void; onSelectMetric?: (label: string) => void }): React.JSX.Element {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric, index) => { const Icon = metricIcons[index % metricIcons.length]; return <Card className={`min-h-24 shadow-none ${metric.action === "details" ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}`} key={metric.label} onClick={() => metric.action === "details" && onSelectMetric ? onSelectMetric(metric.label) : undefined}><CardHeader className="gap-1 p-3"><CardDescription className="flex items-center gap-2"><Icon className="size-4 text-primary" />{metric.label}</CardDescription><CardTitle className="text-lg">{metric.value ?? "Sin datos disponibles"}</CardTitle>{metric.detail ? <p className="text-xs text-muted-foreground">{metric.detail}</p> : null}{metric.action === "block-map" && onShowBlock ? <Button className="mt-1 w-fit" onClick={onShowBlock} size="sm" variant="outline"><MapIcon data-icon="inline-start" />Ver manzana</Button> : null}</CardHeader></Card> })}</div>
}

function ComparativeDetails({ label, report }: { label: string; report: SupplyReport }): React.JSX.Element {
  const current = report.indicators.spatial.currentConsumptionM3 ?? 0;
  
  let content = <EmptyState title="Sin detalles" detail="No hay detalles para este indicador." />;
  let description = "";
  
  if (label === "Ranking de consumo") {
    const avg = report.indicators.spatial.districtAverageM3 ?? 0;
    const district = report.header.district || "el distrito";
    const rank = report.indicators.spatial.districtRank;
    const count = report.indicators.spatial.districtSupplyCount;
    description = rank && count ? `Tu suministro ocupa el puesto ${rank} de ${count} suministros en ${district}.` : `Comparación con el consumo promedio en ${district}.`;
    
    const data = [
      { name: "Promedio Distrito", valor: avg },
      { name: "Suministro Actual", valor: current }
    ];
    content = (
      <div className="flex flex-col gap-2 mt-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="h-64">
          <ChartContainer config={{ valor: { label: "Consumo m3", color: "var(--chart-1)" } }} className="h-full w-full">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={120} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    );
  } else if (label === "Ranking por m2") {
    const currentM2 = report.indicators.spatial.currentSupplyConsumptionPerM2 ?? 0;
    const avgM2 = (report.indicators.spatial.districtAverageM3 ?? 0) / (report.indicators.spatial.lotAreaM2 ?? 1);
    const district = report.header.district || "el distrito";
    const rank = report.indicators.spatial.districtPerAreaRank;
    const count = report.indicators.spatial.districtPerAreaSupplyCount;
    description = rank && count ? `Considerando el área del predio, tu consumo por m² ocupa el puesto ${rank} de ${count} suministros en ${district}.` : `Comparación de la intensidad de consumo (m³/m²) en ${district}.`;
    
    const data = [
      { name: "Promedio Distrito m3/m2", valor: avgM2 > 0 ? avgM2 : 0.5 },
      { name: "Suministro Actual m3/m2", valor: currentM2 }
    ];
    content = (
      <div className="flex flex-col gap-2 mt-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64">
            <ChartContainer config={{ valor: { label: "m3/m2", color: "var(--chart-2)" } }} className="h-full w-full">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={150} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Detalle del ranking</h4>
            {report.indicators.spatial.districtLotPeers && report.indicators.spatial.districtLotPeers.length > 0 ? (
               <div className="max-h-64 overflow-auto rounded-md border">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Cliente</TableHead>
                       <TableHead>Suministro</TableHead>
                       <TableHead className="text-right">Área</TableHead>
                       <TableHead className="text-right">Densidad</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {report.indicators.spatial.districtLotPeers.map((lote, i) => (
                       <TableRow key={i}>
                         <TableCell className="text-xs font-medium">{lote.customerName}</TableCell>
                         <TableCell className="text-xs text-muted-foreground">{lote.supplyCode}</TableCell>
                         <TableCell className="text-right text-xs whitespace-nowrap">{lote.areaM2.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m²</TableCell>
                         <TableCell className="text-right text-xs whitespace-nowrap">{(lote.volume / lote.areaM2).toLocaleString("es-PE", { maximumFractionDigits: 2 })} m³/m²</TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
            ) : (
               <p className="text-xs text-muted-foreground italic">No hay datos de ranking disponibles.</p>
            )}
          </div>
        </div>
      </div>
    );
  } else if (label === "Comparacion de lotes similares") {
    const avg = report.indicators.spatial.similarLotsAverageM3 ?? 0;
    const count = report.indicators.spatial.similarLotsCount ?? 0;
    description = count > 0 ? `Se está comparando tu consumo actual frente al promedio de ${count} lotes que tienen un área y actividad similar en la zona.` : `No hay suficientes lotes con características similares para una comparación precisa.`;
    
    const data = [
      { name: "Promedio Similares", valor: avg },
      { name: "Suministro Actual", valor: current }
    ];
    content = (
      <div className="flex flex-col gap-2 mt-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64">
            <ChartContainer config={{ valor: { label: "Consumo m3", color: "var(--chart-3)" } }} className="h-full w-full">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={130} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Detalle de lotes similares</h4>
            {report.indicators.spatial.similarLots && report.indicators.spatial.similarLots.length > 0 ? (
               <div className="max-h-64 overflow-auto rounded-md border">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Cliente</TableHead>
                       <TableHead>Suministro</TableHead>
                       <TableHead className="text-right">Volumen</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {report.indicators.spatial.similarLots.map((lote, i) => (
                       <TableRow key={i}>
                         <TableCell className="text-xs font-medium">{lote.customerName}</TableCell>
                         <TableCell className="text-xs text-muted-foreground">{lote.supplyCode}</TableCell>
                         <TableCell className="text-right text-xs">{lote.volume.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m³</TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
            ) : (
               <p className="text-xs text-muted-foreground italic">No hay datos de lotes disponibles.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="mt-4 shadow-none">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Detalles: {label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {content}
      </CardContent>
    </Card>
  )
}

type BlockGeometry = NonNullable<SupplyReport["indicators"]["spatial"]["blockGeometry"]>

function BlockLotsDialog({ error, loading, onOpenChange, onRetry, open, report }: { error: string | null; loading: boolean; onOpenChange: (open: boolean) => void; onRetry: () => void; open: boolean; report: SupplyReport }): React.JSX.Element {
  const spatial = report.indicators.spatial
  const geometry = spatial.blockGeometry
  const blockLots = spatial.blockLots ?? []
  const lotSupplies = spatial.lotSupplies ?? []
  const blockSupplies = spatial.blockSupplies ?? []

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Consumo de la manzana {spatial.blockCode ?? "seleccionada"}</DialogTitle>
          <DialogDescription>Distribución catastral real de sus lotes. El lote del suministro {report.supplyCode} está resaltado.</DialogDescription>
        </DialogHeader>
        {loading ? <div className="grid gap-2"><Skeleton className="h-64" /><Skeleton className="h-14" /></div> : geometry && blockLots.length ? (
          <div className="space-y-3">
            <BlockMapContainer blockCode={spatial.blockCode} blockGeometry={geometry} blockLots={blockLots} lotSupplies={lotSupplies} blockSupplies={blockSupplies} />
            <div className="grid gap-2 sm:grid-cols-3">
              <BlockDatum label="Consumo de manzana" value={volume(spatial.blockConsumptionM3)} />
              <BlockDatum label="Lotes" value={number(blockLots.length, 0)} />
              <BlockDatum label="Suministros manzana" value={number(spatial.blockSupplyCount, 0)} />
              <BlockDatum label="Consumo del lote" value={volume(spatial.lotConsumptionM3)} />
              <BlockDatum label="Densidad" value={ratio(spatial.blockConsumptionDensityM3PerM2, "m3/m2")} />
              <BlockDatum label="Por metro lineal" value={ratio(spatial.blockConsumptionPerLinearMeter, "m3/m")} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-primary/65" />Lote actual</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border bg-card" />Otros lotes</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-orange-500" />Suministro actual</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-cyan-500" />Otros en lote</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-400" />Manzana</span>
            </div>
            {lotSupplies.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Suministros del lote</p>
                <div className="max-h-40 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Suministro</TableHead><TableHead className="text-right">Consumo</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {lotSupplies.map((supply) => (
                        <TableRow key={supply.supplyCode}>
                          <TableCell className="flex items-center gap-1.5">
                            <span className={`size-2.5 rounded-full ${supply.isCurrent ? "bg-orange-500" : "bg-cyan-500"}`} />
                            {supply.supplyCode}
                            {supply.isCurrent ? <ShadcnBadge variant="outline">Actual</ShadcnBadge> : null}
                          </TableCell>
                          <TableCell className="text-right">{volume(supply.volume) ?? "Sin consumo"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </div>
        ) : <EmptyState action={<Button className="mt-3" onClick={onRetry} variant="outline">Reintentar geometría</Button>} title="Sin geometría disponible" detail={error ?? "No se recibió la geometría catastral de la manzana."} />}
      </DialogContent>
    </Dialog>
  )
}

type BlockMapContainerProps = {
  blockCode: string | null
  blockGeometry: BlockGeometry
  blockLots: SupplyReport["indicators"]["spatial"]["blockLots"]
  lotSupplies?: NonNullable<SupplyReport["indicators"]["spatial"]["lotSupplies"]>
  blockSupplies?: NonNullable<SupplyReport["indicators"]["spatial"]["blockSupplies"]>
}

function BlockMapContainer({ blockCode, blockGeometry, blockLots, lotSupplies = [], blockSupplies = [] }: BlockMapContainerProps): React.JSX.Element {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!mapContainer.current || !blockGeometry || !blockLots?.length) return

    const blockFeature: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: blockGeometry as Geometry,
        properties: { type: "block" },
      }],
    }

    const lotsFeature: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features: blockLots.map((lot, idx) => ({
        type: "Feature" as const,
        id: idx,
        geometry: lot.geometry as Geometry,
        properties: { isCurrent: lot.isCurrent, lotCode: lot.lotCode },
      })),
    }

    const bounds = new maplibregl.LngLatBounds()
    ;((blockGeometry.type === "Polygon"
      ? blockGeometry.coordinates as number[][][]
      : (blockGeometry.coordinates as number[][][][]).flat()
    ).flat() as [number, number][]).forEach((coord) => bounds.extend(coord))

    if (map.current) {
      map.current.remove()
      map.current = null
    }

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "osm-layer",
            type: "raster",
            source: "osm-tiles",
            minzoom: 0,
            maxzoom: 18,
          },
        ],
      },
      bounds,
      fitBoundsOptions: { padding: 40 },
    })

    map.current.on("load", () => {
      if (!map.current) return

      map.current.addSource("block-source", {
        type: "geojson",
        data: blockFeature,
      })

      map.current.addLayer({
        id: "block-fill",
        type: "fill",
        source: "block-source",
        paint: {
          "fill-color": "#6b7280",
          "fill-opacity": 0.4,
        },
      })

      map.current.addLayer({
        id: "block-line",
        type: "line",
        source: "block-source",
        paint: {
          "line-color": "#374151",
          "line-width": 2,
        },
      })

      map.current.addSource("lots-source", {
        type: "geojson",
        data: lotsFeature,
      })

      map.current.addLayer({
        id: "lots-fill",
        type: "fill",
        source: "lots-source",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "isCurrent"], false],
            "#0ea5e9",
            "#f3f4f6",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "isCurrent"], false],
            0.65,
            0.9,
          ],
        },
      })

      map.current.addLayer({
        id: "lots-line",
        type: "line",
        source: "lots-source",
        paint: {
          "line-color": "#d1d5db",
          "line-width": 1,
        },
      })

      blockLots.forEach((lot, idx) => {
        if (map.current) {
          map.current.setFeatureState(
            { source: "lots-source", id: idx },
            { isCurrent: lot.isCurrent }
          )
        }
      })
    })

    return () => {
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
      if (map.current) {
        map.current.remove()
        map.current = null
      }
    }
  }, [blockGeometry, blockLots])

  // Efecto separado para marcadores: se ejecuta cuando cambian lotSupplies o blockSupplies
  // y garantiza que funcione tanto si el mapa ya cargó como si está cargando
  useEffect(() => {
    if (!map.current) return

    const addMarkers = () => {
      markers.current.forEach((marker) => marker.remove())
      markers.current = []

      // Usamos blockSupplies si existe y tiene elementos; si no, usamos lotSupplies como fallback
      const itemsToRender = blockSupplies.length > 0 ? blockSupplies.map(s => ({
        ...s,
        isLotSupply: s.isLotSupply ?? false
      })) : lotSupplies.map(s => ({
        ...s,
        isLotSupply: true
      }))

      markers.current = itemsToRender
        .filter((supply) => supply.point?.type === "Point")
        .map((supply) => {
          const isCurrent = supply.isCurrent
          const isLotSupply = supply.isLotSupply
          
          const el = document.createElement("div")
          
          // Estilo según tipo de suministro
          let width = "10px"
          let height = "10px"
          let bg = "#94a3b8" // Gris por defecto (manzana)
          let border = "1.5px solid #ffffff"
          
          if (isCurrent) {
            width = "18px"
            height = "18px"
            bg = "#f97316" // Naranja (actual)
            border = "2.5px solid #7c2d12"
          } else if (isLotSupply) {
            width = "13px"
            height = "13px"
            bg = "#06b6d4" // Cian (otros en lote)
            border = "2px solid #ffffff"
          }

          el.style.width = width
          el.style.height = height
          el.style.cursor = "pointer"
          el.style.display = "flex"
          el.style.alignItems = "center"
          el.style.justifyContent = "center"

          // Usamos un elemento hijo para la visualización y animación de escala.
          // MapLibre posiciona 'el' mediante transform, por lo que no debemos aplicar transiciones ni
          // alterar la propiedad transform en 'el' directamente para evitar que el marcador flote o se desvíe.
          const markerInner = document.createElement("div")
          markerInner.style.width = "100%"
          markerInner.style.height = "100%"
          markerInner.style.borderRadius = "9999px"
          markerInner.style.background = bg
          markerInner.style.border = border
          markerInner.style.boxShadow = "0 0 0 1.5px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.25)"
          markerInner.style.transition = "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
          
          el.appendChild(markerInner)

          el.addEventListener("mouseenter", () => { markerInner.style.transform = "scale(1.3)" })
          el.addEventListener("mouseleave", () => { markerInner.style.transform = "scale(1)" })

          const [lng, lat] = supply.point!.coordinates
          const consumoText = supply.volume != null
            ? `${supply.volume.toLocaleString("es-PE")} m³`
            : "Sin consumo"

          let supplyTypeText = "Suministro de la manzana"
          if (isCurrent) {
            supplyTypeText = "Suministro actual"
          } else if (isLotSupply) {
            supplyTypeText = "Suministro en el lote"
          }

          const popupColor = isCurrent ? "#f97316" : (isLotSupply ? "#06b6d4" : "#94a3b8")

          const popup = new maplibregl.Popup({ offset: 14, closeButton: false })
            .setHTML(
              `<div style="font-size:12px;line-height:1.6;min-width:120px">` +
              `<strong style="display:block">${supply.supplyCode}</strong>` +
              `<span style="color:#6b7280">${consumoText}</span>` +
              `<span style="display:block;margin-top:2px;color:${popupColor};font-weight:600">${supplyTypeText}</span>` +
              `</div>`
            )

          return new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .setPopup(popup)
            .addTo(map.current!)
        })
    }

    if (map.current.loaded()) {
      addMarkers()
    } else {
      map.current.once("load", addMarkers)
    }

    return () => {
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
    }
  }, [lotSupplies, blockSupplies])

  return (
    <div
      aria-label={`Manzana ${blockCode ?? "seleccionada"} con ${blockLots?.length ?? 0} lotes`}
      ref={mapContainer}
      className="h-64 overflow-hidden rounded-md border bg-muted/25"
      style={{ position: "relative" }}
    />
  )
}

function BlockDatum({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-semibold">{value ?? "Sin datos"}</p></div>
}

function ConsumptionChart({ compact = false, data }: { compact?: boolean; data: { label: string; consumption: number | null; expected: number | null }[] }): React.JSX.Element {
  if (data.length === 0) return <EmptyState title="Sin datos para graficar" detail="Ajuste el rango de períodos para consultar la serie." />
  return <Card className="mt-2 shadow-none"><CardHeader className="pb-0"><CardTitle className="text-xs">Evolución del consumo de agua facturado</CardTitle><CardDescription>Consumo registrado frente a la mediana histórica esperada.</CardDescription></CardHeader><CardContent className="px-2 pb-2"><ChartContainer className={compact ? "h-44 w-full" : "h-72 w-full"} config={chartConfig}><ComposedChart accessibilityLayer data={data} margin={{ left: 4, right: 12, top: 12 }}><CartesianGrid vertical={false} /><XAxis axisLine={false} dataKey="label" minTickGap={24} tickLine={false} /><YAxis axisLine={false} tickLine={false} width={38} /><ChartTooltip content={<ChartTooltipContent indicator="line" />} /><Bar dataKey="consumption" fill="var(--color-consumption)" maxBarSize={24} radius={[3, 3, 0, 0]} /><Line connectNulls dataKey="expected" dot={{ r: 2 }} stroke="var(--color-expected)" strokeWidth={2} type="monotone" /></ComposedChart></ChartContainer></CardContent></Card>
}

function ConsumptionTable({ rows }: { rows: ReportEvolutionRow[] }): React.JSX.Element {
  return <div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Período</TableHead><TableHead className="text-right">Consumo</TableHead><TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Variación</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={`${row.year}-${row.month}`}><TableCell>{row.label} {row.year}</TableCell><TableCell className="text-right">{volume(row.currentVolume)}</TableCell><TableCell className="text-right">{volume(row.historicalMedian)}</TableCell><TableCell className="text-right">{percent(row.variationVsMedianPercent)}</TableCell><TableCell>{row.isAnomaly ? <ShadcnBadge variant="destructive">Anomalía</ShadcnBadge> : <ShadcnBadge variant="outline">Normal</ShadcnBadge>}</TableCell></TableRow>)}</TableBody></Table></div>
}

function filterDetailRows<T extends object>(rows: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase("es-PE")
  if (!normalized) return rows
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase("es-PE").includes(normalized)))
}

function DetailFilter({ onChange, value }: { onChange: (value: string) => void; value: string }): React.JSX.Element {
  return <div className="relative mb-2 max-w-sm"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Filtrar detalles" className="pl-8" onChange={(event) => onChange(event.target.value)} placeholder="Filtrar detalles..." value={value} /></div>
}

type DetailColumn<T> = { label: string; render: (row: T) => React.ReactNode; align?: "right" }

function DetailTable<T>({ columns, empty, rows }: { columns: DetailColumn<T>[]; empty: string; rows: T[] }): React.JSX.Element {
  if (rows.length === 0) return <EmptyState title="Sin datos disponibles" detail={empty} />
  return <div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader><TableRow>{columns.map((column) => <TableHead className={column.align === "right" ? "text-right" : undefined} key={column.label}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{columns.map((column) => <TableCell className={column.align === "right" ? "text-right" : undefined} key={column.label}>{column.render(row)}</TableCell>)}</TableRow>)}</TableBody></Table></div>
}

function StateReadingsTable({ rows }: { rows: SupplyReport["details"]["stateReadings"] }): React.JSX.Element {
  return <DetailTable empty="No existen tomas de estado para este suministro." rows={rows} columns={[
    { label: "Fecha", render: (row) => row.readingDate ?? "-" },
    { label: "Lectura", render: (row) => row.readingValue ?? "-", align: "right" },
    { label: "Tipo", render: (row) => row.readingType ?? "-" },
    { label: "Medidor", render: (row) => row.meterSerial ?? "-" },
    { label: "Incidencia", render: (row) => row.incidenceLabel ?? "Sin incidencia" },
    { label: "Observación", render: (row) => row.observation ?? row.incidenceDetail ?? "-" },
  ]} />
}

function MeterInstallationsTable({ rows }: { rows: SupplyReport["details"]["meterInstallations"] }): React.JSX.Element {
  return <DetailTable empty="No existen instalaciones de medidor para este suministro." rows={rows} columns={[
    { label: "Instalación", render: (row) => row.installationDate ?? "-" },
    { label: "Medidor", render: (row) => row.meterSerial ?? "-" },
    { label: "Anterior", render: (row) => row.previousMeterSerial ?? "-" },
    { label: "Diámetro", render: (row) => row.diameterMm == null ? "-" : `${row.diameterMm} mm` },
    { label: "Estado", render: (row) => <ShadcnBadge variant="outline">{row.status ?? "Sin estado"}</ShadcnBadge> },
    { label: "Orden", render: (row) => row.workOrderNumber ?? row.serviceOrderNumber ?? "-" },
  ]} />
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  const clean = dateStr.replace(/\s*00:00:00.*$/, "").replace(/T.*$/, "").trim()
  return clean || "-"
}

function priorityBadge(priority: string): React.JSX.Element {
  const norm = (priority ?? "").trim().toLowerCase()
  if (norm === "urgente" || norm === "alta") {
    return <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive ring-1 ring-inset ring-destructive/20">{priority}</span>
  }
  if (norm === "media") {
    return <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20">{priority}</span>
  }
  return <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">{priority}</span>
}

function statusBadge(status: string): React.JSX.Element {
  const norm = (status ?? "").trim().toLowerCase()
  if (norm === "completada" || norm === "realizada" || norm === "cerrada") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20"><CheckCircle2 className="size-3" />{status}</span>
  }
  if (norm === "pendiente" || norm === "en proceso") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20"><Clock className="size-3" />{status}</span>
  }
  return <ShadcnBadge variant="outline">{status}</ShadcnBadge>
}

function typologyBadge(typology: string | null): React.JSX.Element {
  if (!typology || typology === "-") return <span className="text-muted-foreground/60">-</span>
  const norm = typology.trim()
  if (norm.startsWith("TO9")) {
    return <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary ring-1 ring-inset ring-primary/20">{norm}</span>
  }
  if (norm.startsWith("TO6")) {
    return <span className="inline-flex items-center rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 ring-1 ring-inset ring-indigo-500/20">{norm}</span>
  }
  return <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-foreground ring-1 ring-inset ring-border">{norm}</span>
}

function resultBadge(result: string | null): React.JSX.Element {
  if (!result || result === "-") return <span className="text-muted-foreground/60">-</span>
  return <span className="inline-flex items-center rounded-md bg-muted/80 px-2 py-0.5 font-mono text-[11px] font-medium text-foreground ring-1 ring-inset ring-border/60">{result}</span>
}

function OrdersView({ inspections, search, workOrders }: { inspections: SupplyReport["details"]["inspections"]; search: string; workOrders: SupplyReport["details"]["workOrders"] }): React.JSX.Element {
  const filteredOrders = useMemo(() => filterDetailRows(workOrders, search), [workOrders, search])
  const filteredInspections = useMemo(() => filterDetailRows(inspections, search), [inspections, search])

  const totalCount = workOrders.length + inspections.length
  const latestDate = useMemo(() => {
    const dates = [
      ...workOrders.map((o) => o.completedAt ?? o.scheduledDate),
      ...inspections.map((i) => i.visitDate ?? i.inspectionDate),
    ].filter(Boolean) as string[]
    if (dates.length === 0) return null
    dates.sort((a, b) => b.localeCompare(a))
    return formatDate(dates[0])
  }, [workOrders, inspections])

  const topTypology = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of inspections) {
      if (item.typology && item.typology !== "-") {
        counts.set(item.typology, (counts.get(item.typology) ?? 0) + 1)
      }
    }
    let max = 0
    let main: string | null = null
    for (const [typ, count] of counts.entries()) {
      if (count > max) { max = count; main = typ }
    }
    return main
  }, [inspections])

  const hasAnyData = workOrders.length > 0 || inspections.length > 0
  const hasFilteredResults = filteredOrders.length > 0 || filteredInspections.length > 0

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardDescription className="text-xs font-medium">Total Registros</CardDescription>
            <div className="rounded-md bg-primary/10 p-1.5 text-primary"><ClipboardList className="size-4" /></div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-xl font-bold">{totalCount}</div>
            <p className="text-[11px] text-muted-foreground">{workOrders.length} órdenes · {inspections.length} visitas</p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardDescription className="text-xs font-medium">Inspecciones Comerciales</CardDescription>
            <div className="rounded-md bg-indigo-500/10 p-1.5 text-indigo-600 dark:text-indigo-400"><FileCheck className="size-4" /></div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-xl font-bold">{inspections.length}</div>
            <p className="text-[11px] text-muted-foreground">{inspections.length > 0 ? "Visitas registradas" : "Sin visitas"}</p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardDescription className="text-xs font-medium">Última Visita</CardDescription>
            <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400"><Calendar className="size-4" /></div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-sm font-bold truncate">{latestDate ?? "Sin registros"}</div>
            <p className="text-[11px] text-muted-foreground">{latestDate ? "Fecha de actividad" : "Sin actividad reciente"}</p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardDescription className="text-xs font-medium">Tipología Frecuente</CardDescription>
            <div className="rounded-md bg-violet-500/10 p-1.5 text-violet-600 dark:text-violet-400"><Tag className="size-4" /></div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-sm font-bold">{topTypology ? <span className="font-mono">{topTypology}</span> : "Sin tipología"}</div>
            <p className="text-[11px] text-muted-foreground">{topTypology ? "Inspección comercial" : "No registrada"}</p>
          </CardContent>
        </Card>
      </div>

      {!hasAnyData ? (
        <Card className="shadow-none border-dashed">
          <CardContent className="grid place-items-center py-8 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground"><ClipboardList className="size-6" /></div>
            <p className="mt-2 text-sm font-semibold">Sin datos de órdenes ni inspecciones</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">No existen órdenes vinculadas con este suministro.</p>
          </CardContent>
        </Card>
      ) : !hasFilteredResults ? (
        <Card className="shadow-none border-dashed">
          <CardContent className="grid place-items-center py-8 text-center">
            <div className="rounded-full bg-muted p-2.5 text-muted-foreground"><FilterX className="size-5" /></div>
            <p className="mt-2 text-sm font-semibold">Sin coincidencias para la búsqueda</p>
            <p className="mt-1 text-xs text-muted-foreground">No hay registros que coincidan con &quot;{search}&quot;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="overflow-hidden shadow-none">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-primary" />
                <CardTitle className="text-xs font-semibold">Órdenes de trabajo</CardTitle>
              </div>
              <ShadcnBadge variant="outline" className="text-[11px]">{filteredOrders.length}</ShadcnBadge>
            </CardHeader>
            <CardContent className="p-0">
              {filteredOrders.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {workOrders.length === 0 ? "No existen órdenes vinculadas con este suministro." : "Sin órdenes coincidentes."}
                </div>
              ) : (
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-semibold text-xs">Orden</TableHead>
                        <TableHead className="font-semibold text-xs">Tipo</TableHead>
                        <TableHead className="font-semibold text-xs">Título</TableHead>
                        <TableHead className="font-semibold text-xs">Programada</TableHead>
                        <TableHead className="font-semibold text-xs">Prioridad</TableHead>
                        <TableHead className="font-semibold text-xs">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((row) => (
                        <TableRow key={row.code} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-mono text-xs font-semibold text-foreground">{row.code}</TableCell>
                          <TableCell className="text-xs">{row.orderType}</TableCell>
                          <TableCell className="text-xs font-medium">{row.title}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.scheduledDate)}</TableCell>
                          <TableCell className="text-xs">{priorityBadge(row.priority)}</TableCell>
                          <TableCell className="text-xs">{statusBadge(row.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-none">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2">
                <FileCheck className="size-4 text-indigo-600 dark:text-indigo-400" />
                <CardTitle className="text-xs font-semibold">Inspecciones comerciales</CardTitle>
              </div>
              <ShadcnBadge variant="outline" className="text-[11px]">{filteredInspections.length}</ShadcnBadge>
            </CardHeader>
            <CardContent className="p-0">
              {filteredInspections.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {inspections.length === 0 ? "No existen inspecciones comerciales registradas." : "Sin inspecciones coincidentes."}
                </div>
              ) : (
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-semibold text-xs">Visita</TableHead>
                        <TableHead className="font-semibold text-xs">Orden</TableHead>
                        <TableHead className="font-semibold text-xs">Tipología</TableHead>
                        <TableHead className="font-semibold text-xs">Resultado</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Lectura</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInspections.map((row, index) => (
                        <TableRow key={index} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="text-xs font-medium text-foreground whitespace-nowrap">{formatDate(row.visitDate ?? row.inspectionDate)}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{row.workOrderNumber ?? "-"}</TableCell>
                          <TableCell className="text-xs">{typologyBadge(row.typology)}</TableCell>
                          <TableCell className="text-xs">{resultBadge(row.result)}</TableCell>
                          <TableCell className="font-mono text-xs text-right text-foreground">{row.readingValue ? row.readingValue : <span className="text-muted-foreground/60">-</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function AnomaliesTable({ rows }: { rows: SupplyReport["details"]["anomalies"] }): React.JSX.Element {
  return <DetailTable empty="No existen anomalías registradas para este suministro." rows={rows} columns={[
    { label: "Fecha", render: (row) => row.detectedAt },
    { label: "Tipo", render: (row) => row.anomalyType },
    { label: "Detectado", render: (row) => number(row.detectedValue) ?? "-", align: "right" },
    { label: "Esperado", render: (row) => number(row.expectedValue) ?? "-", align: "right" },
    { label: "Desviación", render: (row) => percent(row.deviationPercent) ?? "-", align: "right" },
    { label: "Estado", render: (row) => <ShadcnBadge variant={row.resolved ? "outline" : "destructive"}>{row.resolved ? "Resuelta" : "Pendiente"}</ShadcnBadge> },
  ]} />
}

const billingChartConfig = {
  amount: { label: "Facturación", color: "var(--chart-1)" },
  water: { label: "Consumo", color: "var(--chart-2)" },
} satisfies ChartConfig

function BillingView({ rows }: { rows: SupplyReport["details"]["billing"] }): React.JSX.Element {
  const months = useMemo(() => {
    const grouped = new Map<string, { label: string; amount: number; water: number }>()
    for (const row of rows) {
      const key = `${row.period_year}-${String(row.period_month).padStart(2, "0")}`
      const current = grouped.get(key) ?? { label: `${String(row.period_month).padStart(2, "0")}/${row.period_year}`, amount: 0, water: 0 }
      current.amount += Number(row.amount_soles ?? 0)
      if (row.concept.toLowerCase() === "consumo_agua") current.water += Number(row.billed_volume_m3 ?? 0)
      grouped.set(key, current)
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
  }, [rows])
  if (months.length === 0) return <EmptyState title="Sin datos disponibles" detail="No existe facturación para este suministro." />
  return <><Card className="shadow-none"><CardHeader className="pb-0"><CardTitle className="text-xs">Facturación y consumo</CardTitle></CardHeader><CardContent className="px-2 pb-2"><ChartContainer className="h-64 w-full" config={billingChartConfig}><ComposedChart data={months}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} /><YAxis yAxisId="amount" tickLine={false} width={42} /><YAxis orientation="right" tickLine={false} width={42} yAxisId="water" /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="amount" fill="var(--color-amount)" maxBarSize={24} radius={[3, 3, 0, 0]} yAxisId="amount" /><Line dataKey="water" dot={{ r: 2 }} stroke="var(--color-water)" strokeWidth={2} type="monotone" yAxisId="water" /></ComposedChart></ChartContainer></CardContent></Card><DetailTable empty="No existe facturación." rows={months} columns={[{ label: "Período", render: (row) => row.label }, { label: "Consumo", render: (row) => volume(row.water), align: "right" }, { label: "Facturación", render: (row) => money(row.amount), align: "right" }]} /></>
}

function CadastreView({ report }: { report: SupplyReport }): React.JSX.Element {
  const spatial = report.indicators.spatial
  return <MetricGrid metrics={[
    { label: "Distrito", value: report.header.district, detail: spatial.districtCode ?? undefined },
    { label: "Área del lote", value: spatial.lotAreaM2 == null ? null : `${number(spatial.lotAreaM2)} m2` },
    { label: "Perímetro del lote", value: spatial.lotPerimeterM == null ? null : `${number(spatial.lotPerimeterM)} m` },
    { label: "Niveles", value: number(spatial.lotLevels, 0) },
    { label: "Suministros del lote", value: number(spatial.lotSupplyCount, 0) },
    { label: "Suministros de la manzana", value: number(spatial.blockSupplyCount, 0) },
    { label: "Densidad de consumo", value: ratio((spatial.blockConsumptionDensityM3PerM2 ?? 0) * 1000, "kg/m2") },
    { label: "Consumo por metro lineal", value: ratio(spatial.blockConsumptionPerLinearMeter, "m3/m") },
  ]} />
}

function EmptyState({ action, title, detail, tone = "muted" }: { action?: React.ReactNode; title: string; detail: string; tone?: "muted" | "danger" }): React.JSX.Element {
  return <div className={`grid min-h-48 place-items-center p-6 text-center ${tone === "danger" ? "text-destructive" : "text-muted-foreground"}`}><div>{tone === "danger" ? <AlertCircle className="mx-auto mb-2 size-5" /> : null}<p className="text-sm font-semibold text-foreground">{title}</p><p className="mt-1 max-w-md text-xs">{detail}</p>{action}</div></div>
}
