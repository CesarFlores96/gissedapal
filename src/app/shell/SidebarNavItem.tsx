import type { LucideIcon } from "lucide-react"
import { NavLink } from "react-router"

import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { cn } from "../../lib/utils"

type SidebarNavItemProps = {
  collapsed: boolean
  icon: LucideIcon
  label: string
  to: string
}

export function SidebarNavItem({ collapsed, icon: Icon, label, to }: SidebarNavItemProps): React.JSX.Element {
  const link = (
    <NavLink
      className={({ isActive }) => cn(
        "relative flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        // El indicador de ruta activa es la barra celeste de la izquierda; el
        // azul institucional se reserva para las acciones.
        "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
        isActive
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:opacity-100"
          : "text-sidebar-foreground/70 before:opacity-0 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      to={to}
    >
      <Icon aria-hidden="true" className="shrink-0" size={16} strokeWidth={1.75} />
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
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
