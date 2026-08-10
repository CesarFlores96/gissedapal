import { ChevronDown, Layers3 } from "lucide-react"
import { useState } from "react"

import type { LayerKey, LayerMeta } from "../types"
import { Button, Panel } from "./ui"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

const layerConfig: ReadonlyArray<{ key: LayerKey; label: string; color: string }> = [
  { key: "distritos", label: "Distritos", color: "#a78bfa" },
  { key: "manzanas", label: "Manzanas", color: "#60a5fa" },
  { key: "lotes", label: "Lotes", color: "#fbbf24" },
  { key: "suministros", label: "Suministros", color: "#22d3ee" },
]

type LayerPanelProps = {
  activeLayers: Set<LayerKey>
  layerMeta: Partial<Record<LayerKey, LayerMeta>>
  loading: boolean
  onToggle: (layer: LayerKey) => void
}

export function LayerPanel({ activeLayers, layerMeta, loading, onToggle }: LayerPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  return (
    <Panel
      as="aside"
      className="absolute left-3 top-3 w-[min(19rem,calc(100%-1.5rem))] overflow-hidden"
    >
      <Button
        aria-expanded={expanded}
        className="h-11 w-full justify-start rounded-none border-b px-4 text-sm font-semibold"
        onClick={() => setExpanded((value) => !value)}
        variant="ghost"
      >
        <Layers3 aria-hidden="true" size={18} strokeWidth={1.75} />
        Capas del mapa
        {loading ? <span className="ml-auto size-2 animate-pulse rounded-full bg-primary" /> : null}
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          size={16}
          strokeWidth={1.75}
        />
      </Button>

      {expanded ? (
        <div className="max-h-[min(48vh,20rem)] overflow-y-auto p-2">
          {layerConfig.map(({ key, label, color }) => {
            const meta = layerMeta[key]
            const unavailable = meta?.available === false
            return (
              <Label
                className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 font-normal hover:bg-muted"
                key={key}
              >
                <Checkbox
                  checked={activeLayers.has(key)}
                  onCheckedChange={() => onToggle(key)}
                />
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full ring-1 ring-inset ring-border"
                  style={{ backgroundColor: color }}
                />
                <span className="min-w-0 flex-1 text-sm text-foreground">{label}</span>
                <span className={`text-xs tabular-nums ${unavailable ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {unavailable
                    ? "Sin datos"
                    : meta?.zoomLimited
                      ? `Zoom ${meta.minZoom}+`
                      : meta
                        ? meta.total.toLocaleString("es-PE")
                        : "—"}
                </span>
              </Label>
            )
          })}
        </div>
      ) : null}
    </Panel>
  )
}
