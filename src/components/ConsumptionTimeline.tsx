import {
  AlertTriangle, Ban, CircleHelp, ClipboardList, Droplets, FileWarning, Gauge,
  HardHat, Minus, Ruler, ScrollText, Search, TrendingDown, TrendingUp, Wrench,
} from "lucide-react"
import { useState } from "react"

import {
  CATEGORY_LABELS,
  type ConsumptionEvidence,
  type EvidenceCategory,
  type MonthStatus,
  type MonthTimelineEntry,
} from "../utils/consumptionAnalysis"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog"

type ConsumptionTimelineProps = {
  entries: MonthTimelineEntry[]
  year: number
}

/**
 * Estilo por estado del mes. `dot` pinta el punto del riel y `chip` la etiqueta
 * del encabezado del popup; se mantienen en el mismo mapa para que un estado
 * nuevo no pueda quedar a medio pintar.
 */
const STATUS_STYLES: Record<MonthStatus, { chip: string; dot: string; icon: typeof Minus; ring: string }> = {
  normal: {
    chip: "border-line bg-surface-2 text-fg-muted",
    dot: "border-brand/40 bg-brand/15 text-brand",
    icon: Minus,
    ring: "focus-visible:ring-brand/40",
  },
  zero: {
    chip: "border-danger/30 bg-danger/10 text-danger",
    dot: "border-danger/50 bg-danger/15 text-danger",
    icon: Ban,
    ring: "focus-visible:ring-danger/40",
  },
  low: {
    chip: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "border-amber-600/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
    icon: TrendingDown,
    ring: "focus-visible:ring-amber-500/40",
  },
  high: {
    chip: "border-chart-2/30 bg-chart-2/10 text-chart-2",
    dot: "border-chart-2/50 bg-chart-2/15 text-chart-2",
    icon: TrendingUp,
    ring: "focus-visible:ring-chart-2/40",
  },
  anomaly: {
    chip: "border-danger/30 bg-danger/10 text-danger",
    dot: "border-danger/50 bg-danger/15 text-danger",
    icon: AlertTriangle,
    ring: "focus-visible:ring-danger/40",
  },
  missing: {
    chip: "border-line bg-surface-3 text-fg-subtle",
    dot: "border-line bg-surface-3 text-fg-subtle",
    icon: CircleHelp,
    ring: "focus-visible:ring-line",
  },
  future: {
    chip: "border-line bg-surface-2 text-fg-subtle",
    dot: "border-dashed border-line bg-transparent text-fg-subtle",
    icon: Minus,
    ring: "focus-visible:ring-line",
  },
}

const CATEGORY_ICONS: Record<EvidenceCategory, typeof Droplets> = {
  reading: Droplets,
  stateReading: ClipboardList,
  inspection: Search,
  supervision: HardHat,
  planilla: ScrollText,
  workOrder: Wrench,
  meter: Gauge,
  registry: Ruler,
  contrastation: Gauge,
  anomaly: AlertTriangle,
  adjustment: FileWarning,
}

const RELEVANCE_LABELS: Record<ConsumptionEvidence["relevance"], string> = {
  month: "En el mes",
  window: "Meses previos",
  background: "Estado vigente",
}

/** Leyenda: solo los estados que aparecen realmente en el año mostrado. */
const LEGEND_ORDER: MonthStatus[] = ["normal", "high", "low", "zero", "anomaly", "missing", "future"]

const STATUS_SHORT: Record<MonthStatus, string> = {
  normal: "Regular",
  zero: "Cero",
  low: "Baja",
  high: "Alza",
  anomaly: "Anomalía",
  missing: "Sin lectura",
  future: "Pendiente",
}

function volumeText(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m³`
}

function percentText(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`
}

function EvidenceCard({ item }: { item: ConsumptionEvidence }): React.JSX.Element {
  const Icon = CATEGORY_ICONS[item.category]
  return (
    <li className="rounded-[var(--radius-control)] border border-line bg-surface-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden="true" className="shrink-0 text-brand" size={14} strokeWidth={1.75} />
        <span className="text-[11px] font-semibold text-fg">{CATEGORY_LABELS[item.category]}</span>
        {item.date ? <span className="text-[10px] text-fg-muted">{item.date}</span> : null}
        {item.supplyCode ? (
          <span className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-fg-muted">
            NIS {item.supplyCode}
          </span>
        ) : null}
        <span className="ml-auto rounded-full border border-line px-2 py-px text-[10px] text-fg-subtle">
          {RELEVANCE_LABELS[item.relevance]}
        </span>
      </div>
      <p className="mt-1.5 text-xs font-medium text-fg">{item.title}</p>
      {item.fields.length ? (
        <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {item.fields.map((field) => (
            <div className="flex min-w-0 gap-1.5 text-[11px]" key={field.label}>
              <dt className="shrink-0 text-fg-subtle">{field.label}:</dt>
              <dd className="min-w-0 break-words text-fg-muted">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  )
}

function MonthDetail({ entry }: { entry: MonthTimelineEntry }): React.JSX.Element {
  const groups = new Map<EvidenceCategory, ConsumptionEvidence[]>()
  for (const item of entry.evidence) {
    const bucket = groups.get(item.category)
    if (bucket) bucket.push(item)
    else groups.set(item.category, [item])
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Consumo" value={volumeText(entry.volume)} />
        <StatBox label="Mediana" value={volumeText(entry.median)} />
        <StatBox label="Año anterior" value={volumeText(entry.previousVolume)} />
        <StatBox label="vs. mediana" value={percentText(entry.variationPercent)} />
      </div>

      {entry.suggestion ? (
        <div className="rounded-[var(--radius-control)] border border-brand/25 bg-brand-dim/30 px-3 py-2 text-xs text-brand">
          <strong className="font-semibold">Sugerencia: </strong>
          {entry.suggestion}
        </div>
      ) : null}

      {entry.evidence.length ? (
        <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
          {[...groups.entries()].map(([category, items]) => (
            <section key={category}>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                {CATEGORY_LABELS[category]} · {items.length}
              </h4>
              <ul className="space-y-2">
                {items.map((item, index) => (
                  <EvidenceCard item={item} key={`${item.category}-${item.date ?? index}-${index}`} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2 text-xs text-fg-muted">
          {entry.status === "future"
            ? "El período aún no ha sido facturado."
            : "Ninguna tabla operativa registra eventos asociados a este mes."}
        </p>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-2.5 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-fg">{value}</p>
    </div>
  )
}

/**
 * Riel horizontal con un punto por mes. Sustituye a la lista apilada de fichas:
 * el detalle de cada mes vive en un diálogo, de modo que el reporte no crece en
 * alto según cuántos meses tengan incidencias.
 */
export function ConsumptionTimeline({ entries, year }: ConsumptionTimelineProps): React.JSX.Element | null {
  const [openKey, setOpenKey] = useState<string | null>(null)

  if (!entries.length) return null

  const flagged = entries.filter((entry) => entry.needsExplanation)
  const legend = LEGEND_ORDER.filter((status) => entries.some((entry) => entry.status === status))
  const active = entries.find((entry) => entry.key === openKey) ?? null

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface-2/60 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <AlertTriangle aria-hidden="true" className="text-warning" size={16} strokeWidth={1.75} />
          Análisis de causas · {year}
        </h3>
        <span className="text-[11px] text-fg-muted">
          {flagged.length
            ? `${flagged.length} de ${entries.length} meses requieren explicación`
            : "Sin meses fuera de rango"}
        </span>
        <span className="ml-auto text-[11px] text-fg-subtle">Clic en un mes para ver el detalle</span>
      </div>

      <div className="overflow-x-auto pb-1">
        <ol className="relative flex min-w-max items-start gap-1">
          {/* Riel continuo detrás de los puntos. */}
          <span aria-hidden="true" className="absolute top-4 right-4 left-4 -z-0 h-px bg-line" />
          {entries.map((entry) => {
            const style = STATUS_STYLES[entry.status]
            const Icon = style.icon
            return (
              <li className="relative z-10 flex flex-col items-center" key={entry.key}>
                <button
                  aria-label={`${entry.monthName} ${entry.year}: ${entry.statusLabel}, ${volumeText(entry.volume)}`}
                  className={`grid size-8 place-items-center rounded-full border-2 transition-transform outline-none hover:scale-110 focus-visible:ring-2 ${style.dot} ${style.ring} ${
                    entry.needsExplanation ? "shadow-[var(--shadow-raised)]" : ""
                  }`}
                  onClick={() => setOpenKey(entry.key)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={13} strokeWidth={2.25} />
                </button>
                <span className="mt-1 w-14 text-center text-[10px] font-medium text-fg-muted">{entry.shortName}</span>
                <span className="w-14 text-center text-[10px] text-fg-subtle">
                  {entry.volume != null ? `${entry.volume} m³` : "—"}
                </span>
                {entry.evidence.length ? (
                  <span className="mt-0.5 rounded-full border border-line bg-surface-1 px-1.5 text-[9px] text-fg-subtle">
                    {entry.evidence.length}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
        {legend.map((status) => {
          const style = STATUS_STYLES[status]
          const Icon = style.icon
          return (
            <span className="flex items-center gap-1 text-[10px] text-fg-muted" key={status}>
              <span className={`grid size-4 place-items-center rounded-full border ${style.dot}`}>
                <Icon aria-hidden="true" size={9} strokeWidth={2.5} />
              </span>
              {STATUS_SHORT[status]}
            </span>
          )
        })}
      </div>

      <Dialog onOpenChange={(open) => { if (!open) setOpenKey(null) }} open={active !== null}>
        <DialogContent className="max-w-2xl">
          {active ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {active.monthName} {active.year}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[active.status].chip}`}>
                    {active.statusLabel}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {active.evidence.length
                    ? `${active.evidence.length} registro(s) hallados · ${active.monthEvidenceCount} dentro del mes`
                    : "Sin registros operativos asociados."}
                </DialogDescription>
              </DialogHeader>
              <MonthDetail entry={active} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
