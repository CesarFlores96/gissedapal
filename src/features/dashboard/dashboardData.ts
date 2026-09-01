import type {
  DashboardBilledAmountRow,
  DashboardBilledVolumeRow,
  DashboardCustomerRow,
  DashboardPaymentRow,
} from "../../types"

/**
 * Normalización del payload del dashboard, portada desde la app web
 * (`apps/web/src/modules/dashboard/lib/utils.ts`) para que ambas superficies
 * agreguen la cartera exactamente igual. Postgres serializa `numeric` como
 * texto, así que todo importe pasa por `parseMoney` antes de sumarse.
 */

export const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const

export type CustomerSummary = {
  classification: "Buen pagador" | "Regular" | "Mal pagador"
  customerCode: string
  district: string
  name: string
  segment: string
  supplyCount: number
  totalDebt: number
}

export type AnnualSeriesRow = {
  fuentePropia: number
  grandesClientes: number
  periodYear: number
  total: number
}

export type MonthlySeriesRow = {
  fuentePropia: number
  grandesClientes: number
  label: string
  total: number
}

export type LabelledTotal = { label: string; total: number }

export type ShareRow = LabelledTotal & { color: string }

export function parseMoney(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toLocaleString("es-PE")
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-PE", { currency: "PEN", maximumFractionDigits: 0, style: "currency" }).format(value)
}

export function formatVolume(value: number): string {
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(value)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(value)
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function truncateLabel(value: string, maxLength = 30): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/** Mayúsculas sin diacríticos: la clave con la que se agrupan clientes. */
export function normalizeCustomerKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

function normalizeClassification(value: string | null | undefined): CustomerSummary["classification"] {
  const normalized = normalizeCustomerKey(value)
  if (normalized.includes("MAL")) return "Mal pagador"
  if (normalized.includes("REGULAR")) return "Regular"
  return "Buen pagador"
}

function classificationWeight(value: CustomerSummary["classification"]): number {
  if (value === "Mal pagador") return 3
  if (value === "Regular") return 2
  return 1
}

/**
 * Agrupa las filas por cliente (una fila por suministro) y se queda con la peor
 * clasificación de pago del grupo. Los suministros de la propia SEDAPAL se
 * excluyen: inflarían la cartera sin representar deuda de terceros.
 */
export function buildCustomers(rows: DashboardCustomerRow[]): CustomerSummary[] {
  const grouped = new Map<string, CustomerSummary>()

  for (const row of rows) {
    const normalizedName = normalizeCustomerKey(row.customer_name)
    if (normalizedName.includes("SEDAPAL")) continue

    const key = row.customer_id || row.customer_code || normalizedName || "SIN-CODIGO"
    const currentClassification = normalizeClassification(row.payer_classification)
    const summary = grouped.get(key) ?? {
      classification: currentClassification,
      customerCode: row.customer_code ?? key,
      district: row.district ?? "SIN DISTRITO",
      name: row.customer_name ?? "Cliente sin nombre",
      segment: row.segment_name ?? "Sin segmentar",
      supplyCount: 0,
      totalDebt: parseMoney(row.total_debt_soles),
    }

    if (classificationWeight(currentClassification) > classificationWeight(summary.classification)) {
      summary.classification = currentClassification
    }
    if (summary.district === "SIN DISTRITO" && row.district) summary.district = row.district
    if (summary.segment === "Sin segmentar" && row.segment_name) summary.segment = row.segment_name
    if (row.supply_code) {
      summary.supplyCount += 1
      summary.totalDebt += parseMoney(row.supply_debt_soles)
    }

    grouped.set(key, summary)
  }

  return [...grouped.values()].sort((a, b) => b.totalDebt - a.totalDebt)
}

function splitByCategory(category: string): "fuentePropia" | "grandesClientes" {
  return normalizeCustomerKey(category).includes("FUENTE") ? "fuentePropia" : "grandesClientes"
}

function buildAnnualRows(
  rows: Array<{ customer_category: string; period_year: number | string }>,
  amountOf: (index: number) => number,
): AnnualSeriesRow[] {
  const grouped = new Map<number, AnnualSeriesRow>()

  rows.forEach((row, index) => {
    const periodYear = Number(row.period_year)
    if (!Number.isFinite(periodYear)) return
    const current = grouped.get(periodYear) ?? { fuentePropia: 0, grandesClientes: 0, periodYear, total: 0 }
    const amount = amountOf(index)
    current[splitByCategory(row.customer_category)] += amount
    current.total += amount
    grouped.set(periodYear, current)
  })

  return [...grouped.values()].sort((a, b) => a.periodYear - b.periodYear)
}

export function buildAnnualVolumeRows(rows: DashboardBilledVolumeRow[]): AnnualSeriesRow[] {
  return buildAnnualRows(rows, (index) => parseMoney(rows[index].total_volume_m3))
}

export function buildAnnualAmountRows(rows: DashboardBilledAmountRow[]): AnnualSeriesRow[] {
  return buildAnnualRows(rows, (index) => parseMoney(rows[index].total_amount_soles))
}

export function buildMonthlyVolumeRows(
  rows: DashboardBilledVolumeRow[],
  year: number | null,
): MonthlySeriesRow[] {
  if (year === null) return []
  const grouped = new Map<number, MonthlySeriesRow>()

  for (const row of rows) {
    if (Number(row.period_year) !== year) continue
    const month = Number(row.period_month)
    if (!Number.isFinite(month) || month < 1 || month > 12) continue

    const current = grouped.get(month) ?? {
      fuentePropia: 0,
      grandesClientes: 0,
      label: MONTH_LABELS[month - 1],
      total: 0,
    }
    const volume = parseMoney(row.total_volume_m3)
    current[splitByCategory(row.customer_category)] += volume
    current.total += volume
    grouped.set(month, current)
  }

  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)
}

export function paymentYearsOf(rows: DashboardPaymentRow[]): number[] {
  const years = new Set<number>()
  for (const row of rows) {
    const year = Number((row.payment_date ?? "").slice(0, 4))
    if (Number.isFinite(year) && year > 0) years.add(year)
  }
  return [...years].sort((a, b) => b - a)
}

export type PaymentRecordRow = { actual: number; label: string; target: number }

/**
 * Recaudación mensual del año elegido. `target` es la banda de referencia que
 * dibuja la app web detrás de la barra real: un 22% sobre el propio mes o el
 * 82% del mejor mes del año, lo que resulte mayor.
 */
export function buildPaymentRecordRows(rows: DashboardPaymentRow[], year: number | null): PaymentRecordRow[] {
  if (year === null) return []
  const grouped = new Map<number, number>()

  for (const row of rows) {
    const date = row.payment_date
    if (!date) continue
    const rowYear = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    if (rowYear !== year || !Number.isFinite(month) || month < 1 || month > 12) continue
    grouped.set(month, (grouped.get(month) ?? 0) + parseMoney(row.amount_soles))
  }

  const ordered = MONTH_LABELS.map((label, index) => ({ actual: grouped.get(index + 1) ?? 0, label }))
  const ceiling = Math.max(...ordered.map((row) => row.actual), 0)
  return ordered.map((row) => ({ ...row, target: Math.max(row.actual * 1.22, ceiling * 0.82) }))
}

export function buildShareRows(rows: LabelledTotal[], colors: readonly string[]): ShareRow[] {
  return rows.map((row, index) => ({ ...row, color: colors[index % colors.length] }))
}

export function sumTotals(rows: LabelledTotal[]): number {
  return rows.reduce((sum, row) => sum + row.total, 0)
}
