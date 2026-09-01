import { Activity, Building2, CircleDollarSign, Crown, Droplet, RefreshCw, UsersRound } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

import { useSession } from "../../app/session/sessionContext"
import { Badge, Button, IconButton } from "../../components/ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Skeleton } from "../../components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import { friendlyError } from "../../lib/errors"
import { getDashboard } from "../../lib/ipc"
import type { DashboardPayload, DashboardTab } from "../../types"
import {
  buildAnnualAmountRows, buildAnnualVolumeRows, buildCustomers, buildMonthlyVolumeRows,
  buildPaymentRecordRows, buildShareRows, formatAxisValue, formatCount, formatCurrency,
  formatPercent, formatVolume, type LabelledTotal, normalizeCustomerKey, parseMoney,
  paymentYearsOf, type ShareRow, sumTotals, truncateLabel,
} from "./dashboardData"

/** Paleta compartida con la app web para que ambos dashboards se lean igual. */
const OFFICE_COLORS = ["#2684ff", "#1e3a8a", "#0f766e", "#7c3aed"] as const
const DONUT_COLORS = ["#2684ff", "#1e40af", "#f97316", "#7e22ce", "#ec4899", "#8b5cf6", "#eab308", "#ef4444"] as const
const PAYMENT_COLORS = { actual: "#4f46e5", target: "rgba(99, 102, 241, 0.16)", targetLine: "rgba(99, 102, 241, 0.34)" } as const
const MONTHLY_VOLUME_COLORS = { fuentePropia: "#60a5fa", grandesClientes: "#1e3a8a", total: "#0f172a" } as const

const AXIS_TICK = { fill: "var(--color-fg-muted)", fontSize: 11 }
const CATEGORY_TICK = { fill: "var(--color-fg)", fontSize: 11 }

/** Ejes y rejilla idénticos en todos los gráficos del tablero. */
function Grid(): React.JSX.Element {
  return <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
}

function Panel({
  children, description, title,
}: { children: React.ReactNode; description?: string; title: string }): React.JSX.Element {
  return (
    <section className="flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface-1">
      <header className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  )
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-12 text-center text-xs text-fg-muted">
      {message}
    </div>
  )
}

function ChartSkeleton(): React.JSX.Element {
  return (
    <div className="flex h-72 flex-col gap-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="w-full flex-1" />
    </div>
  )
}

function ShareLegend({ items, total }: { items: ShareRow[]; total: number }): React.JSX.Element {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2" key={item.label}>
          <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-fg">{item.label}</p>
            <p className="text-[11px] text-fg-muted">
              {formatCurrency(item.total)} · {formatPercent(total > 0 ? (item.total / total) * 100 : 0)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Barras horizontales de deuda: antigüedad, usos y deudores comparten forma. */
function DebtBarChart({
  color, data, labelKey = "label", nameKey, width = 150,
}: { color: string; data: Array<Record<string, unknown>>; labelKey?: string; nameKey?: string; width?: number }): React.JSX.Element {
  return (
    <div className="h-72">
      <ResponsiveContainer debounce={200} height="100%" width="100%">
        <BarChart data={data} layout="vertical" margin={{ bottom: 0, left: 4, right: 12, top: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} type="number" />
          <YAxis
            axisLine={false}
            dataKey={labelKey}
            tick={CATEGORY_TICK}
            tickFormatter={(value: string) => truncateLabel(value, 26)}
            tickLine={false}
            type="category"
            width={width}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value))}
            labelFormatter={(value, payload) =>
              nameKey ? String(payload?.[0]?.payload?.[nameKey] ?? value) : String(value)}
          />
          <Bar dataKey="total" fill={color} isAnimationActive={false} name="Deuda" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function MetricCard({
  icon: Icon, label, value,
}: { icon: typeof UsersRound; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-h-20 items-start justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-surface-1 p-4 transition-colors hover:border-brand/30">
      <div className="min-w-0 space-y-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
        <p className="truncate text-base font-semibold tracking-tight text-fg">{value}</p>
      </div>
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-dim text-brand">
        <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
      </span>
    </div>
  )
}

/** Estado de carga por pestaña: cada tab pide solo sus propias consultas. */
type TabState = { data: DashboardPayload | null; error: string | null; loading: boolean }

const EMPTY_TAB: TabState = { data: null, error: null, loading: false }

export function DashboardWorkspace(): React.JSX.Element {
  const { reportError } = useSession()
  const [tab, setTab] = useState<DashboardTab>("resumen")
  const [tabs, setTabs] = useState<Record<DashboardTab, TabState>>({
    resumen: EMPTY_TAB, distribucion: EMPTY_TAB, volumenes: EMPTY_TAB,
  })
  const [paymentYear, setPaymentYear] = useState<number | null>(null)
  const [volumeYear, setVolumeYear] = useState<number | null>(null)

  // Diferido un microtask: el linter de efectos prohíbe llamar a setState de
  // forma síncrona en el cuerpo del efecto (mismo patrón que SupplyReportRoute).
  const load = useCallback((target: DashboardTab, force = false) => {
    let skipped = false
    void Promise.resolve()
      .then(() => {
        setTabs((current) => {
          if (!force && (current[target].data || current[target].loading)) {
            skipped = true
            return current
          }
          return { ...current, [target]: { data: current[target].data, error: null, loading: true } }
        })
      })
      .then(() => (skipped ? null : getDashboard(target)))
      .then((payload) => {
        if (skipped || !payload) return
        setTabs((current) => ({ ...current, [target]: { data: payload, error: null, loading: false } }))
      })
      .catch((reason: unknown) => {
        if (skipped || reportError(reason)) return
        setTabs((current) => ({
          ...current,
          [target]: { data: current[target].data, error: friendlyError(reason), loading: false },
        }))
      })
  }, [reportError])

  // Cada pestaña se pide la primera vez que se abre: el payload completo son
  // tres bloques de consultas pesadas y el resumen es lo único que se ve al
  // entrar. Rust cachea la respuesta, así que volver a una pestaña es inmediato.
  useEffect(() => { load(tab) }, [load, tab])

  const summary = tabs.resumen
  const data = summary.data

  const customers = buildCustomers(data?.customers ?? [])
  const criticalCustomers = customers.filter((customer) => customer.classification === "Mal pagador")
  const topCustomers = (data?.fpDebtSummary.topDebtors ?? [])
    .map((debtor) => ({
      customerCode: debtor.customer_code ?? normalizeCustomerKey(debtor.customer_name) ?? "SIN-CODIGO",
      debt: parseMoney(debtor.total_debt),
      district: debtor.district ?? "SIN DISTRITO",
      name: debtor.customer_name,
      segment: debtor.segment_name ?? "Sin segmentar",
    }))
    .filter((debtor) => !normalizeCustomerKey(debtor.name).includes("SEDAPAL"))
    .slice(0, 5)

  const snapshotDebt = parseMoney(data?.fpDebtSummary.snapshotTotalDebt)
  const totalDebt = snapshotDebt > 0
    ? snapshotDebt
    : customers.reduce((sum, customer) => sum + customer.totalDebt, 0)
  const topFiveTotalDebt = topCustomers.reduce((sum, customer) => sum + customer.debt, 0)
  const topFiveCoverage = totalDebt > 0 ? (topFiveTotalDebt / totalDebt) * 100 : 0
  const matchedPaymentCount = Number(data?.paymentSummary.totals.matched_payment_count ?? 0)
  const paymentTotalAmount = parseMoney(data?.paymentSummary.totals.total_amount)

  const paymentYears = paymentYearsOf(data?.monthlyPayments ?? [])
  const activePaymentYear = paymentYear !== null && paymentYears.includes(paymentYear)
    ? paymentYear
    : paymentYears[0] ?? null
  const paymentRows = (data?.monthlyPayments ?? []).filter(
    (row) => Number((row.payment_date ?? "").slice(0, 4)) === activePaymentYear,
  )
  const paymentRecordData = buildPaymentRecordRows(data?.monthlyPayments ?? [], activePaymentYear)
  const yearlyPaymentAmount = paymentRows.reduce((sum, row) => sum + parseMoney(row.amount_soles), 0)
  const paymentAverage = paymentRows.length > 0 ? yearlyPaymentAmount / paymentRows.length : 0
  const topOfficeAmount = parseMoney(data?.paymentSummary.offices[0]?.total_amount ?? 0)

  const paymentStats = [
    { label: "Pagos del año", progress: paymentRows.length > 0 ? 100 : 0, value: formatCount(paymentRows.length) },
    {
      label: "Monto anual",
      progress: paymentTotalAmount > 0 ? (yearlyPaymentAmount / paymentTotalAmount) * 100 : 0,
      value: formatCurrency(yearlyPaymentAmount),
    },
    {
      label: "Promedio por pago",
      progress: paymentRecordData.length > 0
        ? (paymentAverage / Math.max(...paymentRecordData.map((item) => item.target), 1)) * 100
        : 0,
      value: formatCurrency(paymentAverage),
    },
    {
      label: "Oficina líder",
      progress: paymentTotalAmount > 0 ? (topOfficeAmount / paymentTotalAmount) * 100 : 0,
      value: formatCurrency(topOfficeAmount),
    },
  ]

  const topDebtTrend = topCustomers.map((customer, index) => ({
    debt: customer.debt, label: `Top ${index + 1}`, name: customer.name,
  }))

  const analytics = tabs.distribucion.data?.debtAnalytics
  const toTotals = <T,>(rows: T[] | undefined, label: (row: T) => string, debt: (row: T) => number | string): LabelledTotal[] =>
    (rows ?? []).map((row) => ({ label: label(row), total: parseMoney(debt(row)) }))

  const debtAgeRows = toTotals(analytics?.ageRanges, (row) => row.bucket_label.replace(/^\d+\.-/, "").trim(), (row) => row.total_debt)
  const officeRows = toTotals(analytics?.officeTotals, (row) => row.office_name, (row) => row.total_debt)
  const topUsesRows = toTotals(analytics?.topUses, (row) => row.use_label, (row) => row.total_debt)
  const tariffRows = toTotals(analytics?.tariffTotals, (row) => row.tariff_label, (row) => row.total_debt)
  const zoneRows = toTotals(analytics?.zoneTotals, (row) => row.zone_label, (row) => row.total_debt)
  const topDebtorRows = (tabs.distribucion.data?.fpDebtSummary.topDebtors ?? [])
    .filter((debtor) => !normalizeCustomerKey(debtor.customer_name).includes("SEDAPAL"))
    .slice(0, 8)
    .map((debtor) => ({ label: truncateLabel(debtor.customer_name, 34), name: debtor.customer_name, total: parseMoney(debtor.total_debt) }))

  const officeShare = buildShareRows(officeRows, OFFICE_COLORS)
  const tariffShare = buildShareRows(tariffRows, DONUT_COLORS)
  const zoneShare = buildShareRows(zoneRows, DONUT_COLORS)

  const volumes = tabs.volumenes.data
  const annualVolumeRows = buildAnnualVolumeRows(volumes?.billedVolumeProjection ?? [])
  const annualAmountRows = buildAnnualAmountRows(volumes?.billedAmountProjection ?? [])
  const monthlyVolumeRows = buildMonthlyVolumeRows(volumes?.billedVolumeProjection ?? [], volumeYear)
  const volumeYearSeries = annualVolumeRows.find((row) => row.periodYear === volumeYear) ?? null

  const headline = [
    { label: "Clientes", value: formatCount(customers.length) },
    { label: "Críticos", value: formatCount(criticalCustomers.length) },
    { label: "Cobertura top 5", value: formatPercent(topFiveCoverage) },
    { label: "Pagos enlazados", value: formatCount(matchedPaymentCount) },
  ]

  return (
    <section aria-label="Dashboard" className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <header className="rounded-[var(--radius-panel)] border border-line bg-surface-1 px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <Badge tone="brand">Dashboard</Badge>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-fg">Centro de control operativo</h2>
                  <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">
                    Resumen ejecutivo de cartera, clientes críticos y actividad reciente
                  </p>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {headline.map((item) => (
                    <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2" key={item.label}>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-fg-subtle">{item.label}</p>
                      <p className="mt-1.5 text-sm font-semibold text-fg">{summary.loading && !data ? "…" : item.value}</p>
                    </div>
                  ))}
                </div>
                <IconButton
                  icon={<RefreshCw aria-hidden="true" size={16} strokeWidth={1.75} />}
                  label="Actualizar dashboard"
                  onClick={() => load(tab, true)}
                  variant="ghost"
                />
              </div>
            </div>
          </header>

          {tabs[tab].error ? (
            <p className="rounded-[var(--radius-control)] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger">
              {tabs[tab].error}
            </p>
          ) : null}

          <Tabs onValueChange={(value) => setTab(value as DashboardTab)} value={tab}>
            <TabsList className="w-full">
              <TabsTrigger value="resumen">
                <Activity aria-hidden="true" /> Resumen
              </TabsTrigger>
              <TabsTrigger value="distribucion">
                <Building2 aria-hidden="true" /> Distribución
              </TabsTrigger>
              <TabsTrigger value="volumenes">
                <Droplet aria-hidden="true" /> Volúmenes
              </TabsTrigger>
            </TabsList>

            <TabsContent className="space-y-4" value="resumen">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.loading && !data
                  ? [0, 1, 2, 3].map((index) => <Skeleton className="h-20 rounded-[var(--radius-panel)]" key={index} />)
                  : (
                    <>
                      <MetricCard icon={UsersRound} label="Clientes críticos" value={formatCount(criticalCustomers.length)} />
                      <MetricCard icon={CircleDollarSign} label="Deuda total" value={formatCurrency(totalDebt)} />
                      <MetricCard icon={Crown} label="Deuda top 5" value={formatCurrency(topFiveTotalDebt)} />
                      <MetricCard icon={Building2} label="Mayor exposición" value={topCustomers[0]?.district ?? "Sin dato"} />
                    </>
                  )}
              </div>

              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <Panel description={`Todos los pagos mensuales de ${activePaymentYear ?? "—"}`} title="Registro de pagos">
                  {summary.loading && !data ? (
                    <ChartSkeleton />
                  ) : paymentRecordData.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-1.5">
                        {paymentYears.map((year) => (
                          <Button
                            className="rounded-full px-3"
                            key={year}
                            onClick={() => setPaymentYear(year)}
                            size="sm"
                            variant={year === activePaymentYear ? "secondary" : "outline"}
                          >
                            {year}
                          </Button>
                        ))}
                      </div>
                      <div className="h-[320px]">
                        <ResponsiveContainer debounce={200} height="100%" width="100%">
                          <ComposedChart data={paymentRecordData} margin={{ bottom: 0, left: -8, right: 8, top: 16 }}>
                            <Grid />
                            <XAxis axisLine={false} dataKey="label" tick={AXIS_TICK} tickLine={false} />
                            <YAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} />
                            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                            <Bar barSize={12} dataKey="target" fill={PAYMENT_COLORS.target} isAnimationActive={false} name="Referencia" radius={[6, 6, 0, 0]} />
                            <Bar barSize={12} dataKey="actual" fill={PAYMENT_COLORS.actual} isAnimationActive={false} name="Recaudado" radius={[6, 6, 0, 0]} />
                            <Line dataKey="target" dot={false} isAnimationActive={false} name="Curva de referencia" stroke={PAYMENT_COLORS.targetLine} strokeWidth={2} type="monotone" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {paymentStats.map((item) => {
                          const clamped = Math.max(4, Math.min(100, item.progress))
                          return (
                            <div className="rounded-[var(--radius-control)] border border-dashed border-line bg-surface-2/50 px-3 py-2.5" key={item.label}>
                              <p className="text-[11px] text-fg-muted">{item.label}</p>
                              <p className="mt-1 text-lg font-semibold tracking-tight text-fg">{item.value}</p>
                              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${clamped}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <EmptyState message="No hay datos de pagos para graficar." />
                  )}
                </Panel>

                <Panel description="Comparativo de mayor exposición por cliente" title="Concentración de deuda top 5">
                  {summary.loading && !data ? (
                    <ChartSkeleton />
                  ) : topCustomers.length > 0 ? (
                    <div className="space-y-2.5">
                      <div className="h-56">
                        <ResponsiveContainer debounce={200} height="100%" width="100%">
                          <AreaChart data={topDebtTrend} margin={{ bottom: 0, left: -16, right: 8, top: 12 }}>
                            <defs>
                              <linearGradient id="dashboardTopDebt" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.42} />
                                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.06} />
                              </linearGradient>
                            </defs>
                            <Grid />
                            <XAxis axisLine={false} dataKey="label" tick={AXIS_TICK} tickLine={false} />
                            <YAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} />
                            <Tooltip
                              formatter={(value) => formatCurrency(Number(value))}
                              labelFormatter={(_, payload) => String(payload?.[0]?.payload?.name ?? "Cliente")}
                            />
                            <Area dataKey="debt" fill="url(#dashboardTopDebt)" isAnimationActive={false} name="Deuda" stroke="#312e81" strokeWidth={2.5} type="monotone" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      {topCustomers.map((customer, index) => (
                        <div
                          className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2"
                          key={`${customer.customerCode}-${index}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-fg">{customer.name}</p>
                            <p className="truncate text-[11px] text-fg-muted">{customer.district} · {customer.segment}</p>
                          </div>
                          <p className="shrink-0 text-xs font-semibold text-fg">{formatCurrency(customer.debt)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState message="No hay clientes para mostrar." />
                  )}
                </Panel>
              </div>
            </TabsContent>

            <TabsContent className="grid gap-4 xl:grid-cols-2" value="distribucion">
              <Panel description="Cartera agrupada por tramo real de vencimiento" title="Deuda total por antigüedad">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : debtAgeRows.length > 0 ? <DebtBarChart color="#3b82f6" data={debtAgeRows} />
                  : <EmptyState message="No hay tramos de antigüedad disponibles." />}
              </Panel>

              <Panel description="Participación de la deuda activa por oficina" title="Oficina comercial">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : officeShare.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_210px] md:items-center">
                      <div className="h-60">
                        <ResponsiveContainer debounce={200} height="100%" width="100%">
                          <PieChart>
                            <Pie data={officeShare} dataKey="total" innerRadius={54} isAnimationActive={false} nameKey="label" outerRadius={88} paddingAngle={2}>
                              {officeShare.map((row) => <Cell fill={row.color} key={row.label} />)}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ShareLegend items={officeShare} total={sumTotals(officeRows)} />
                    </div>
                  ) : <EmptyState message="No hay deuda por oficina para mostrar." />}
              </Panel>

              <Panel description="Rubros y tipologías con mayor concentración de deuda" title="Top usos con mayor deuda">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : topUsesRows.length > 0 ? <DebtBarChart color="#06b6d4" data={topUsesRows} width={160} />
                  : <EmptyState message="No hay usos con deuda para mostrar." />}
              </Panel>

              <Panel description="Composición de la cartera por tipo tarifario" title="Deuda total por tarifa">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : tariffShare.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_210px] md:items-center">
                      <div className="h-60">
                        <ResponsiveContainer debounce={200} height="100%" width="100%">
                          <PieChart>
                            <Pie data={tariffShare} dataKey="total" innerRadius={58} isAnimationActive={false} nameKey="label" outerRadius={92} paddingAngle={2}>
                              {tariffShare.map((row) => <Cell fill={row.color} key={row.label} />)}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ShareLegend items={tariffShare} total={sumTotals(tariffRows)} />
                    </div>
                  ) : <EmptyState message="No hay tarifas para mostrar." />}
              </Panel>

              <Panel description="Clientes con mayor saldo acumulado en el corte actual" title="Top mayores deudores">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : topDebtorRows.length > 0 ? <DebtBarChart color="#ec4899" data={topDebtorRows} nameKey="name" width={180} />
                  : <EmptyState message="No hay deudores para mostrar." />}
              </Panel>

              <Panel description="Distribución de deuda por zona operativa principal" title="Deuda total por CC.SS.">
                {tabs.distribucion.loading ? <ChartSkeleton />
                  : zoneShare.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_210px] md:items-center">
                      <div className="h-60">
                        <ResponsiveContainer debounce={200} height="100%" width="100%">
                          <PieChart>
                            <Pie data={zoneShare} dataKey="total" isAnimationActive={false} nameKey="label" outerRadius={92} paddingAngle={2}>
                              {zoneShare.map((row) => <Cell fill={row.color} key={row.label} />)}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ShareLegend items={zoneShare} total={sumTotals(zoneRows)} />
                    </div>
                  ) : <EmptyState message="No hay zonas operativas para mostrar." />}
              </Panel>
            </TabsContent>

            <TabsContent className="grid gap-4 lg:grid-cols-2" value="volumenes">
              <Panel
                description="Consumo facturado por Grandes Clientes y Fuente Propia. Clic en un año para ver el detalle mensual"
                title="Volumen facturado anual"
              >
                {tabs.volumenes.loading ? <ChartSkeleton />
                  : annualVolumeRows.length > 0 ? (
                    <div className="h-72">
                      <ResponsiveContainer debounce={200} height="100%" width="100%">
                        <BarChart data={annualVolumeRows} margin={{ bottom: 0, left: -8, right: 12, top: 16 }}>
                          <Grid />
                          <XAxis axisLine={false} dataKey="periodYear" tick={AXIS_TICK} tickLine={false} />
                          <YAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} />
                          <Tooltip formatter={(value) => `${formatVolume(Number(value))} m³`} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar
                            className="cursor-pointer"
                            dataKey="fuentePropia"
                            fill="#8b5cf6"
                            isAnimationActive={false}
                            name="Fuente Propia"
                            onClick={(entry: { payload?: { periodYear?: number } }) => setVolumeYear(entry?.payload?.periodYear ?? null)}
                            radius={[4, 4, 0, 0]}
                            stackId="volume"
                          />
                          <Bar
                            className="cursor-pointer"
                            dataKey="grandesClientes"
                            fill="#06b6d4"
                            isAnimationActive={false}
                            name="Grandes Clientes"
                            onClick={(entry: { payload?: { periodYear?: number } }) => setVolumeYear(entry?.payload?.periodYear ?? null)}
                            radius={[4, 4, 0, 0]}
                            stackId="volume"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState message="No hay volumen facturado para graficar." />}
              </Panel>

              <Panel description="Facturación anual en soles por Grandes Clientes y Fuente Propia" title="Monto facturado anual">
                {tabs.volumenes.loading ? <ChartSkeleton />
                  : annualAmountRows.length > 0 ? (
                    <div className="h-72">
                      <ResponsiveContainer debounce={200} height="100%" width="100%">
                        <BarChart data={annualAmountRows} margin={{ bottom: 0, left: -8, right: 12, top: 16 }}>
                          <Grid />
                          <XAxis axisLine={false} dataKey="periodYear" tick={AXIS_TICK} tickLine={false} />
                          <YAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} />
                          <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="fuentePropia" fill="#22c55e" isAnimationActive={false} name="Fuente Propia" radius={[4, 4, 0, 0]} stackId="amount" />
                          <Bar dataKey="grandesClientes" fill="#f59e0b" isAnimationActive={false} name="Grandes Clientes" radius={[4, 4, 0, 0]} stackId="amount" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState message="No hay monto facturado para graficar." />}
              </Panel>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog onOpenChange={(open) => { if (!open) setVolumeYear(null) }} open={volumeYear !== null}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Consumo facturado mensual {volumeYear ?? ""}</DialogTitle>
            <DialogDescription>Desglose por mes del año seleccionado en el volumen facturado anual.</DialogDescription>
          </DialogHeader>
          {volumeYearSeries ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              {[
                { label: "Total anual", value: volumeYearSeries.total },
                { label: "Fuente Propia", value: volumeYearSeries.fuentePropia },
                { label: "Grandes Clientes", value: volumeYearSeries.grandesClientes },
              ].map((item) => (
                <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2" key={item.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-fg">{formatVolume(item.value)} m³</p>
                </div>
              ))}
            </div>
          ) : null}
          {monthlyVolumeRows.length > 0 ? (
            <div className="h-[340px]">
              <ResponsiveContainer debounce={200} height="100%" width="100%">
                <ComposedChart data={monthlyVolumeRows} margin={{ bottom: 0, left: -8, right: 12, top: 16 }}>
                  <Grid />
                  <XAxis axisLine={false} dataKey="label" tick={AXIS_TICK} tickLine={false} />
                  <YAxis axisLine={false} tick={AXIS_TICK} tickFormatter={(value) => formatAxisValue(Number(value))} tickLine={false} />
                  <Tooltip formatter={(value) => `${formatVolume(Number(value))} m³`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="fuentePropia" fill={MONTHLY_VOLUME_COLORS.fuentePropia} isAnimationActive={false} name="Fuente Propia" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="grandesClientes" fill={MONTHLY_VOLUME_COLORS.grandesClientes} isAnimationActive={false} name="Grandes Clientes" radius={[6, 6, 0, 0]} />
                  <Line dataKey="total" dot={{ r: 3 }} isAnimationActive={false} name="Total" stroke={MONTHLY_VOLUME_COLORS.total} strokeWidth={2} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState message="No hay detalle mensual disponible para este año." />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
