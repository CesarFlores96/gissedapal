import type { LucideIcon } from "lucide-react"
import { NavLink } from "react-router"

import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { cn } from "../../lib/utils"

type SidebarNavItemProps = {
  collapsed: boolean
  icon: LucideIcon
  label: string
  /** Texto corto mostrado bajo el icono cuando la barra está colapsada, para no depender solo del hover/tooltip. */
  shortLabel: string
  to: string
}

export function SidebarNavItem({ collapsed, icon: Icon, label, shortLabel, to }: SidebarNavItemProps): React.JSX.Element {
  const link = (
    <NavLink
      className={({ isActive }) => cn(
        "relative flex items-center rounded-md text-[13px] outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        // El indicador de ruta activa es la barra celeste de la izquierda; el
        // azul institucional se reserva para las acciones.
        "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
        isActive
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:opacity-100"
          : "text-sidebar-foreground/70 before:opacity-0 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        collapsed ? "h-auto flex-col justify-center gap-1 px-1 py-2" : "h-[34px] gap-2.5 px-2.5",
      )}
      to={to}
    >
      <Icon aria-hidden="true" className="shrink-0" size={16} strokeWidth={1.75} />
      {collapsed
        ? <span className="max-w-full truncate text-[10px] font-medium leading-none">{shortLabel}</span>
        : <span className="truncate">{label}</span>}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
