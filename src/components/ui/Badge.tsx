import type { ReactNode } from "react"

import { ShadcnBadge } from "./shadcn-badge"

export type BadgeTone = "neutral" | "brand" | "lot" | "block" | "warning"

const tones: Record<BadgeTone, string> = {
  neutral: "",
  brand: "border-primary/30 bg-primary/5 text-primary",
  lot: "border-chart-3/30 bg-chart-3/5 text-chart-3",
  block: "border-chart-2/30 bg-chart-2/5 text-chart-2",
  warning: "border-amber-600/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
}

type BadgeProps = {
  children: ReactNode
  className?: string
  tone?: BadgeTone
}

/** Chip compacto para tipos y estados (Lote / Manzana / Distrito NN). */
export function Badge({ children, className = "", tone = "neutral" }: BadgeProps): React.JSX.Element {
  return (
    <ShadcnBadge className={`text-[10px] uppercase ${tones[tone]} ${className}`} variant="outline">
      {children}
    </ShadcnBadge>
  )
}
