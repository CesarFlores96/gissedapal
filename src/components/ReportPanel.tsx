import { AlertTriangle, ArrowDownRight, BarChart3, CalendarDays, Droplets, Sparkles, X } from "lucide-react"
import { useState } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts"

import type { ReportEvolutionRow, ReportSeverity, SupplyReport } from "../types"
import { Badge, Button, type BadgeTone, IconButton } from "./ui"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

type ReportPanelProps = {
  data: SupplyReport | null
  error: string | null
  loading: boolean
  onClose: () => void
  supplyCode: string | null
}

const severityTone: Record<ReportSeverity, BadgeTone> = {
  normal: "brand",
  observation: "neutral",
  probable: "warning",
  critical: "warning",
}

const insightIcons = [ArrowDownRight, BarChart3, AlertTriangle, CalendarDays]

function volumeText(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m³`
}

function percentText(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`
}

function soleText(value: number): string {
  return `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type ChartRow = ReportEvolutionRow & { anomalyMarker: number | null }

type TooltipEntry = {
  color?: string
  dataKey?: string
  name?: string
  value?: number
}

function ChartTooltip({ active, label, payload }: { active?: boolean; label?: string; payload?: TooltipEntry[] }): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/95 px-3 py-2 text-xs shadow-[var(--shadow-raised)] backdrop-blur-xl">
      <p className="mb-1 font-semibold text-fg">{label}</p>
      {payload.map((entry) => (
        entry.value == null ? null : (
          <p className="flex items-center gap-1.5 text-fg-muted" key={entry.dataKey}>
            <span className="size-2 rounded-full" style={{ background: entry.color }} />
            {entry.name}: <strong className="text-fg">{volumeText(entry.value)}</strong>
          </p>
        )
      ))}
    </div>
  )
}

function StatCard({ label, sub, value }: { label: string; sub?: string | null; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="mt-1 text-sm font-semibold text-fg">
        {value}
        {sub ? <span className="ml-1.5 text-xs font-normal text-fg-muted">{sub}</span> : null}
      </p>
    </div>
  )
}

export function ReportPanel({ data, error, loading, onClose, supplyCode }: ReportPanelProps): React.JSX.Element | null {
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  // Ajusta el año seleccionado cuando llega un reporte nuevo, siguiendo el mismo
  // patrón que InspectorDrawer usa para su estado "frozen": ajustar durante el
  // render (no en un efecto) evita el disparo síncrono de setState que el
  // linter de efectos prohíbe para llamadas de red.
  const [yearSourceData, setYearSourceData] = useState<SupplyReport | null>(null)
  if (data && data !== yearSourceData) {
    setYearSourceData(data)
    setSelectedYear(data.years[0] ?? null)
  }

  const year = selectedYear != null ? data?.analysisByYear[String(selectedYear)] : undefined
  const chartRows: ChartRow[] = (year?.evolutionRows ?? []).map((row) => ({
    ...row,
    anomalyMarker: row.isAnomaly ? row.currentVolume : null,
  }))

  return (
    <section aria-label="Reporte de consumo" className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3">
        <div className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-brand/35 bg-brand-dim text-brand">
          <Droplets aria-hidden="true" size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Reporte de consumo</p>
          <h2 className="truncate font-semibold text-fg">{data?.header.customerName ?? supplyCode ?? "Cargando…"}</h2>
        </div>
        <IconButton icon={<X aria-hidden="true" size={18} strokeWidth={1.75} />} label="Cerrar reporte" onClick={onClose} variant="ghost" />
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div aria-busy="true" className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div className="h-16 animate-pulse rounded-[var(--radius-control)] bg-surface-3" key={item} />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-[var(--radius-control)] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        ) : data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">
                {data.supplyCode} · {data.header.district ?? "Sin distrito"}
              </span>
              <Badge tone="brand">{data.header.classification}</Badge>
              <Badge tone={data.header.payerClassification === "Mal pagador" ? "warning" : "neutral"}>
                {data.header.payerClassification}
              </Badge>
              <Badge tone={data.header.serviceStatus === "Activo" ? "brand" : "warning"}>
                {data.header.serviceStatus}
              </Badge>
              <span className="ml-auto text-xs text-fg-muted">
                Saldo actual: <strong className="text-fg">{soleText(data.header.debt)}</strong>
              </span>
            </div>

            {data.years.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.years.map((availableYear) => (
                  <Button
                    className={`rounded-full px-3 ${
                      availableYear === selectedYear
                        ? ""
                        : "text-muted-foreground"
                    }`}
                    key={availableYear}
                    onClick={() => setSelectedYear(availableYear)}
                    size="sm"
                    variant={availableYear === selectedYear ? "secondary" : "outline"}
                  >
                    {availableYear}
                  </Button>
                ))}
              </div>
            ) : null}

            {year ? (
              <>
                <section className="rounded-[var(--radius-panel)] border border-line bg-surface-2/60 p-3">
                  <h3 className="mb-2 text-sm font-semibold text-fg">Evolución del consumo de agua facturada</h3>
                  <ResponsiveContainer height={260} width="100%">
                    <ComposedChart data={chartRows} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
                      <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 5" vertical={false} />
                      <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} tickLine={false} />
                      <YAxis axisLine={false} tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} tickLine={false} width={44} />
                      <Tooltip content={<ChartTooltip />} cursor={false} isAnimationActive={false} />
                      <Bar
                        barSize={20}
                        dataKey="currentVolume"
                        fill="var(--color-brand)"
                        isAnimationActive={false}
                        name={`Año actual (${selectedYear})`}
                        radius={[6, 6, 0, 0]}
                      />
                      <Line
                        connectNulls={false}
                        dataKey="historicalMedian"
                        dot={{ r: 3 }}
                        isAnimationActive={false}
                        name="Mediana histórica"
                        stroke="var(--color-accent)"
                        strokeWidth={2.5}
                        type="monotone"
                      />
                      <Line
                        dataKey="previousVolume"
                        dot={{ r: 2.5 }}
                        isAnimationActive={false}
                        name={`Año anterior (${(selectedYear ?? 0) - 1})`}
                        stroke="var(--color-fg-subtle)"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        type="monotone"
                      />
                      <Scatter dataKey="anomalyMarker" fill="var(--color-danger)" isAnimationActive={false} name="Anomalía detectada" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </section>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <StatCard label="Acumulado del período" value={volumeText(year.summary.accumulatedVolume)} />
                  <StatCard
                    label="vs. Mediana acumulada"
                    sub={year.summary.medianDeltaM3 != null ? volumeText(year.summary.medianDeltaM3) : null}
                    value={percentText(year.summary.medianDeltaPercent) ?? "—"}
                  />
                  <StatCard
                    label="vs. Año anterior"
                    sub={year.summary.previousDeltaM3 != null ? volumeText(year.summary.previousDeltaM3) : null}
                    value={percentText(year.summary.previousDeltaPercent) ?? "—"}
                  />
                </div>

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-fg">Detalle mensual</h3>
                  <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mes</TableHead>
                          <TableHead>Año actual</TableHead>
                          <TableHead>Mediana histórica</TableHead>
                          <TableHead>Año anterior</TableHead>
                          <TableHead>vs. mediana</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {year.evolutionRows.map((row) => (
                          <TableRow className={row.isAnomaly ? "bg-destructive/5" : ""} key={`${row.year}-${row.month}`}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell className="text-muted-foreground">{volumeText(row.currentVolume)}</TableCell>
                            <TableCell className="text-muted-foreground">{volumeText(row.historicalMedian)}</TableCell>
                            <TableCell className="text-muted-foreground">{volumeText(row.previousVolume)}</TableCell>
                            <TableCell className={row.isAnomaly ? "font-semibold text-destructive" : "text-muted-foreground"}>
                              {percentText(row.variationVsMedianPercent) ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>

                <section className="rounded-[var(--radius-panel)] border border-line bg-surface-2/60 p-3">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                    <Sparkles aria-hidden="true" size={16} strokeWidth={1.75} /> Hallazgos automáticos
                  </h3>
                  {year.insightCards.length ? (
                    <ul className="space-y-2">
                      {year.insightCards.map((card, index) => {
                        const Icon = insightIcons[index % insightIcons.length]
                        return (
                          <li className="flex gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-1/70 px-3 py-2.5" key={card.title}>
                            <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-brand" size={15} strokeWidth={1.75} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-fg">{card.title}</p>
                              <p className="mt-0.5 text-xs text-fg-muted">{card.description}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-fg-muted">Sin hallazgos relevantes para este período.</p>
                  )}
                  {year.analysis.severity !== "normal" ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                      <Badge tone={severityTone[year.analysis.severity]}>{year.analysis.severity}</Badge>
                      <span className="text-xs text-fg-muted">Puntaje de anomalía: {year.analysis.score}</span>
                    </div>
                  ) : null}
                </section>
              </>
            ) : (
              <p className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2 text-xs text-fg-muted">
                Sin datos de facturación para este período.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
