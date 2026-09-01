import { Activity, ChevronsUpDown, FileBarChart2, Gauge, LayoutDashboard, LogOut, MapPinned, Moon, Sun } from "lucide-react"
import { Link } from "react-router"

import { Button } from "../../components/ui"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { cn } from "../../lib/utils"
import { useSession } from "../session/sessionContext"
import { useTheme } from "../theme/themeContext"
import { SidebarNavItem } from "./SidebarNavItem"

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", shortLabel: "Panel", to: "/dashboard" },
  { icon: MapPinned, label: "Mapa", shortLabel: "Mapa", to: "/mapa" },
  { icon: Gauge, label: "Suministros y Medidores", shortLabel: "Suminis.", to: "/suministros" },
  { icon: Activity, label: "Alertas", shortLabel: "Alertas", to: "/analisis/alertas" },
  // El nombre coincide con el título de la página (routes.tsx) y el <h2> de ReportsWorkspace.
  { icon: FileBarChart2, label: "Análisis de indicadores", shortLabel: "Reportes", to: "/analisis/reportes" },
] as const

export function Sidebar({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const { session, logout } = useSession()
  const { theme, toggleTheme } = useTheme()

  const email = session?.user?.email ?? null
  const isDark = theme === "dark"

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[4.5rem]" : "w-60",
      )}
    >
      <div className={cn("flex h-12 shrink-0 items-center gap-2 px-2.5", collapsed && "justify-center px-0")}>
        <Link
          className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
          to="/mapa"
        >
          <MapPinned aria-hidden="true" size={15} strokeWidth={2} />
        </Link>
        {collapsed ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-heading text-[13px] font-semibold">SEDAPAL GIS</p>
            <p className="truncate text-[11px] text-sidebar-foreground/55">Lima y Callao</p>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 px-2 pt-1">
        {navItems.map((item) => (
          <SidebarNavItem
            collapsed={collapsed}
            icon={item.icon}
            key={item.to}
            label={item.label}
            shortLabel={item.shortLabel}
            to={item.to}
          />
        ))}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-2">

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                className={cn(
                  "h-[34px] w-full justify-start gap-2.5 px-2.5 text-[13px] font-normal text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0",
                )}
                onClick={toggleTheme}
                variant="ghost"
              >
                {isDark
                  ? <Sun aria-hidden="true" size={16} strokeWidth={1.75} />
                  : <Moon aria-hidden="true" size={16} strokeWidth={1.75} />}
                {collapsed ? null : <span>{isDark ? "Modo claro" : "Modo oscuro"}</span>}
              </Button>
            }
          />
          {collapsed ? <TooltipContent side="right">{isDark ? "Modo claro" : "Modo oscuro"}</TooltipContent> : null}
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Cuenta"
                className={cn(
                  "h-[34px] w-full justify-start gap-2.5 px-2.5 text-[13px] font-normal text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0",
                )}
                variant="ghost"
              >
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[10px] font-semibold text-sidebar-accent-foreground"
                >
                  {(email ?? "?").charAt(0).toUpperCase()}
                </span>
                {collapsed ? null : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left">{email ?? "Sesión activa"}</span>
                    <ChevronsUpDown aria-hidden="true" size={13} strokeWidth={1.75} />
                  </>
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56" side="top">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {email ?? "Sesión activa"}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void logout() }}>
              <LogOut aria-hidden="true" size={14} strokeWidth={1.75} />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
