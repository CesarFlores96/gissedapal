export type TrendDirection = "increasing" | "decreasing" | "either"

export type ConsumptionFilter = {
  direction: TrendDirection
  percentage: number
  baselineStartPeriod: string
  baselineEndPeriod: string
  targetStartPeriod: string
  targetEndPeriod: string
}

function formatPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function shiftMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

/**
 * Vive fuera de ReportsWorkspace.tsx (que se carga con `lazy`) para que el
 * splash pueda precargar el reporte por defecto sin arrastrar ese chunk pesado
 * al bundle inicial.
 */
export function defaultConsumptionFilter(): ConsumptionFilter {
  const now = new Date()
  const targetEnd = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const targetStart = shiftMonth(targetEnd, -5)
  const baselineEnd = shiftMonth(targetStart, -1)
  return {
    direction: "either",
    percentage: 30,
    baselineStartPeriod: formatPeriod(shiftMonth(baselineEnd, -11)),
    baselineEndPeriod: formatPeriod(baselineEnd),
    targetStartPeriod: formatPeriod(targetStart),
    targetEndPeriod: formatPeriod(targetEnd),
  }
}
