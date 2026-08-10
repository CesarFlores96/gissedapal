import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Suspense, useCallback, useEffect, useState } from "react"
import { Outlet, useLocation, useMatches } from "react-router"

import { Button } from "../../components/ui"
import { TooltipProvider } from "../../components/ui/tooltip"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { MapSlot } from "../../features/map/MapSlot"
import { cn } from "../../lib/utils"
import type { RouteHandle } from "../routeHandle"
import { NavigationProgress } from "./NavigationProgress"
import { PageHeader } from "./PageHeader"
import { Sidebar } from "./Sidebar"
import { TrafficLights } from "./TrafficLights"

function MapSkeleton(): React.JSX.Element {
  return <div className="grid h-full place-items-center text-sm text-muted-foreground">Preparando mapa…</div>
}

const STORAGE_KEY = "sedapalgis-sidebar"

export function AppShell(): React.JSX.Element {
  const matches = useMatches()
  const location = useLocation()
  const handle = [...matches].reverse().find((match) => match.handle)?.handle as RouteHandle | undefined
  const showsMap = handle?.showsMap === true

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(STORAGE_KEY) === "1")

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      window.localStorage.setItem(STORAGE_KEY, current ? "0" : "1")
      return !current
    })
  }, [])

  // Sin esto el foco se queda en el ítem del sidebar y los lectores de pantalla
  // no anuncian que la vista cambió.
  useEffect(() => {
    document.getElementById("route-title")?.focus()
  }, [location.pathname])

  return (
    <TooltipProvider>
      <div className="grid h-screen grid-cols-[auto_1fr] overflow-hidden bg-background text-foreground">
        <Sidebar collapsed={sidebarCollapsed} />

        <div className="grid min-h-0 min-w-0 grid-rows-[3rem_1fr]">
          {/* Title bar personalizada: toda la franja es zona de arrastre
              gracias a `data-tauri-drag-region`. Los botones internos cancelan
              el drag con su propio pointer-events. */}
          <header
            className="flex h-12 min-w-0 shrink-0 items-center gap-2 border-b bg-background px-3"
            data-tauri-drag-region
          >
            {/* Botón de contraer/expandir sidebar */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
                    className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={toggleSidebar}
                    size="icon"
                    variant="ghost"
                  >
                    {sidebarCollapsed
                      ? <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.75} />
                      : <PanelLeftClose aria-hidden="true" size={16} strokeWidth={1.75} />}
                  </Button>
                }
              />
              <TooltipContent side="bottom">
                {sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
              </TooltipContent>
            </Tooltip>

            {handle?.header ? handle.header() : <PageHeader title={handle?.title} />}

            {/* Traffic lights al extremo derecho */}
            <TrafficLights />
          </header>

          {/* `isolate` crea un único contexto de apilamiento: dentro de <main>
              solo hay dos hijos y el orden del DOM basta para ordenarlos, así
              que ningún panel necesita ya z-index propio. */}
          <main className="relative isolate min-h-0 overflow-hidden">
            {/* Capa 0 — mapa persistente. Nunca se desmonta.
                `visibility` y no `display:none`: esta última colapsa el
                contenedor a tamaño cero y al volver MapLibre tendría
                dimensiones obsoletas (mapa en blanco hasta un resize y una
                nueva petición de tiles). Con `visibility` la caja de layout se
                mantiene, así que la cámara y los tiles sobreviven intactos. */}
            <div
              aria-hidden={!showsMap}
              className="absolute inset-0"
              inert={!showsMap}
              style={{ visibility: showsMap ? "visible" : "hidden" }}
            >
              <Suspense fallback={<MapSkeleton />}>
                <MapSlot />
              </Suspense>
            </div>

            {/* Capa 1 — contenido de ruta. Va encima por orden del DOM. */}
            <div
              className={cn(
                "relative h-full min-h-0 opacity-100 transition-opacity duration-150 starting:opacity-0",
                showsMap ? "pointer-events-none" : "overflow-hidden bg-background",
              )}
              key={location.pathname}
            >
              <NavigationProgress />
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
