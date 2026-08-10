import type { ElementType, ReactNode, Ref } from "react"

import { cn } from "@/lib/utils"

type PanelProps = {
  /** Elemento host. Por defecto `section`; los paneles con rol semántico usan `aside`. */
  as?: ElementType
  children: ReactNode
  className?: string
  /** `raised` para el inspector, que flota sobre el resto del chrome. */
  elevation?: "panel" | "raised"
  ref?: Ref<HTMLElement>
} & Record<string, unknown>

/**
 * Superficie flotante del visor: fondo casi negro translúcido, borde de 1px,
 * sombra compuesta y grano. Sustituye la repetición de
 * `bg-white/95 border-slate-200 shadow-xl backdrop-blur` que había en cada panel.
 */
export function Panel({
  as: Component = "section",
  children,
  className = "",
  elevation = "panel",
  ref,
  ...rest
}: PanelProps): React.JSX.Element {
  return (
    <Component
      className={cn(
        "rounded-md border bg-card text-card-foreground",
        elevation === "raised" ? "shadow-lg" : "shadow-sm",
        className,
      )}
      ref={ref}
      {...rest}
    >
      {children}
    </Component>
  )
}
