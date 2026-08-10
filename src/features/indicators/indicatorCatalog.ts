import { AlertTriangle, BarChart3, BrainCircuit, Building2, CircleDollarSign, Droplets, Gauge } from "lucide-react"

import type { IndicatorViewKey } from "./mdiState"

export const INDICATOR_FAMILIES: Record<IndicatorViewKey, { title: string; shortTitle: string; icon: typeof Droplets }> = {
  consumption: { title: "Indicadores de consumo", shortTitle: "Consumo", icon: Droplets },
  spatial: { title: "Indicadores espaciales", shortTitle: "Espaciales", icon: Building2 },
  comparative: { title: "Indicadores comparativos", shortTitle: "Comparativos", icon: BarChart3 },
  efficiency: { title: "Indicadores de eficiencia", shortTitle: "Eficiencia", icon: Gauge },
  risk: { title: "Indicadores de riesgo", shortTitle: "Riesgo", icon: AlertTriangle },
  economic: { title: "Indicadores economicos", shortTitle: "Economicos", icon: CircleDollarSign },
  predictive: { title: "Indicadores predictivos", shortTitle: "Predictivos", icon: BrainCircuit },
  esce: { title: "Indicadores ESCE", shortTitle: "ESCE", icon: BrainCircuit },
}
