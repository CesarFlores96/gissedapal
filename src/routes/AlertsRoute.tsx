import { AlertTriangle, ArrowDown, BarChart3, Copy, Droplets, ExternalLink, FileText, MapPin, Search, X } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { useSession } from "../app/session/sessionContext"
import { Button } from "../components/ui"
import { getCachedScan, loadScan } from "../features/alerts/dropsCache"
import { useSelection } from "../features/selection/selectionContext"
import { friendlyError } from "../lib/errors"
import { getAbruptConsumptionDrops } from "../lib/ipc"
import type { ConsumptionDrop, ConsumptionDropScan } from "../types"

function volume(value: number): string {
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m³`
}

function period(value: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00`)
  return new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(date)
}

type FilterKind = "all" | "zero" | "extremely_low"

export function AlertsRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { reportError } = useSession()
  const { selectSupply } = useSelection()
  const [data, setData] = useState<ConsumptionDropScan | null>(() => getCachedScan())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [filterKind, setFilterKind] = useState<FilterKind>("all")
  const [selectedItem, setSelectedItem] = useState<ConsumptionDrop | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  useEffect(() => {
    if (getCachedScan()) return
    let active = true
    void Promise.resolve()
      .then(() => {
        if (active) { setLoading(true); setError(null) }
        return loadScan(getAbruptConsumptionDrops)
      })
      .then((scan) => { if (active) setData(scan) })
      .catch((reason: unknown) => {
        if (!active) return
        if (!reportError(reason)) setError(friendlyError(reason))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reportError])

  const filteredItems = useMemo(() => {
    if (!data?.items) return []
    return data.items.filter((item) => {
      if (filterKind !== "all" && item.kind !== filterKind) {
        return false
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const matchCode = item.supplyCode.toLowerCase().includes(query)
        const matchName = item.customerName?.toLowerCase().includes(query) ?? false
        const matchDistrict = item.district?.toLowerCase().includes(query) ?? false
        return matchCode || matchName || matchDistrict
      }
      return true
    })
  }, [data, filterKind, searchQuery])

  const handleSelectAlert = (item: ConsumptionDrop) => {
    setSelectedItem(item)
    void selectSupply(item.supplyCode)
  }

  const handleCopySupplyCode = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true)
      window.setTimeout(() => setCopiedCode(false), 1800)
    })
  }

  return (
    <div className="relative flex h-full w-full justify-between overflow-hidden pointer-events-none">
      {/* Panel Lateral Izquierdo: Lista de Alertas */}
      <aside className="pointer-events-auto flex h-full w-[360px] md:w-[390px] max-w-[calc(100%-2rem)] flex-col border-r bg-background/95 shadow-xl backdrop-blur shrink-0 z-10">
        {/* Cabecera y Buscador */}
        <div className="shrink-0 border-b p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle aria-hidden="true" size={18} strokeWidth={2} />
              </div>
              <div>
                <h1 className="text-sm font-semibold leading-none">Alertas de consumo</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Caídas abruptas detectadas</p>
              </div>
            </div>
            {data?.items.length ? (
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {filteredItems.length}
              </span>
            ) : null}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground bg-muted/50 rounded-md p-2 border">
            Consumo facturado igual a cero o menor al 15% del promedio de los 3 meses previos.
          </p>

          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              className="w-full rounded-md border bg-background py-1.5 pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por NIS, cliente o distrito..."
              type="text"
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          {/* Filtros rápidos */}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterKind === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/70 text-secondary-foreground hover:bg-secondary"
              }`}
              onClick={() => setFilterKind("all")}
              type="button"
            >
              Todas
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterKind === "zero"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/20"
              }`}
              onClick={() => setFilterKind("zero")}
              type="button"
            >
              Consumo Cero
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterKind === "extremely_low"
                  ? "bg-chart-5 text-white"
                  : "bg-chart-5/10 text-chart-5 hover:bg-chart-5/20"
              }`}
              onClick={() => setFilterKind("extremely_low")}
              type="button"
            >
              Caída Fuerte
            </button>
          </div>
        </div>

        {/* Lista compacta de Alertas */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div aria-busy="true" className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div className="h-16 animate-pulse rounded-md bg-muted" key={item} />
              ))}
            </div>
          ) : error ? (
            <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : filteredItems.length ? (
            filteredItems.map((item) => {
              const isSelected = selectedItem?.supplyCode === item.supplyCode
              return (
                <div
                  className={`group relative rounded-lg border p-2.5 text-xs transition-all cursor-pointer ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary"
                      : "bg-card hover:border-primary/50 hover:bg-accent/40"
                  }`}
                  key={`${item.supplyCode}-${item.period}`}
                  onClick={() => handleSelectAlert(item)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`grid size-6 shrink-0 place-items-center rounded-md ${
                          item.kind === "zero"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-chart-5/10 text-chart-5"
                        }`}
                      >
                        <ArrowDown aria-hidden="true" size={13} strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{item.supplyCode}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.customerName ?? "Cliente no registrado"}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.kind === "zero"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-chart-5/15 text-chart-5"
                      }`}
                    >
                      -{item.dropPercent}%
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t pt-1.5">
                    <span className="truncate">{item.district ?? "Sin distrito"}</span>
                    <div className="flex items-center gap-1 font-medium">
                      <Droplets aria-hidden="true" className="text-primary" size={12} />
                      <span className="text-foreground">{volume(item.currentVolume)}</span>
                      <span className="text-muted-foreground">vs {volume(item.referenceVolume)}</span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      className="w-full h-7 text-xs gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectAlert(item)
                      }}
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                    >
                      <MapPin size={13} />
                      Ver en el mapa
                    </Button>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="rounded-md border bg-card px-3 py-8 text-center">
              <Droplets aria-hidden="true" className="mx-auto mb-2 text-primary" size={20} />
              <p className="text-xs font-medium">No se encontraron alertas</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Intenta ajustar los filtros de búsqueda o severidad.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Panel Lateral Derecho: Detalles del Suministro Seleccionado */}
      {selectedItem ? (
        <aside className="pointer-events-auto flex h-full w-[380px] md:w-[400px] max-w-[calc(100%-2rem)] flex-col border-l bg-background/95 shadow-2xl backdrop-blur shrink-0 z-10 transition-all duration-300 animate-in slide-in-from-right">
          {/* Header del Panel de Detalles */}
          <header className="flex items-center justify-between border-b p-4 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <MapPin aria-hidden="true" size={18} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">Detalles del Suministro</h2>
                <p className="text-xs font-mono text-muted-foreground truncate">NIS: {selectedItem.supplyCode}</p>
              </div>
            </div>
            <button
              aria-label="Cerrar detalles del suministro"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => setSelectedItem(null)}
              type="button"
            >
              <X size={16} />
            </button>
          </header>

          {/* Cuerpo de Detalles */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Tarjeta 1: Ficha del Suministro */}
            <div className="rounded-lg border bg-card p-3 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-muted-foreground font-medium">Ficha del Suministro</span>
                <button
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  onClick={() => handleCopySupplyCode(selectedItem.supplyCode)}
                  type="button"
                >
                  <Copy size={12} />
                  <span>{copiedCode ? "Copiado" : "Copiar NIS"}</span>
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-muted-foreground block">NIS / Código:</span>
                  <span className="font-mono text-sm font-bold text-foreground">{selectedItem.supplyCode}</span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">Nombre del Cliente:</span>
                  <span className="font-semibold text-foreground break-words">
                    {selectedItem.customerName ?? "Cliente no registrado"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Distrito:</span>
                    <span className="font-medium text-foreground">{selectedItem.district ?? "Sin distrito"}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Estado Alerta:</span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        selectedItem.kind === "zero"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-chart-5/15 text-chart-5"
                      }`}
                    >
                      {selectedItem.kind === "zero" ? "Consumo Cero" : "Caída Fuerte"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tarjeta 2: Análisis de Caída de Consumo */}
            <div className="rounded-lg border bg-card p-3 space-y-3 shadow-sm">
              <div className="flex items-center gap-1.5 border-b pb-2 text-foreground font-semibold">
                <BarChart3 className="text-primary" size={15} />
                <span>Análisis de Facturación</span>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Periodo evaluado:</span>
                  <span className="font-semibold text-foreground capitalize">{period(selectedItem.period)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 border">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Consumo Actual:</span>
                    <span className="text-sm font-bold text-foreground">{volume(selectedItem.currentVolume)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Ref. 3 meses previos:</span>
                    <span className="text-sm font-semibold text-foreground">{volume(selectedItem.referenceVolume)}</span>
                  </div>
                </div>

                {/* Barra de progreso comparativa */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Caída relativa:</span>
                    <span
                      className={`font-bold ${
                        selectedItem.kind === "zero" ? "text-destructive" : "text-chart-5"
                      }`}
                    >
                      -{selectedItem.dropPercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all rounded-full ${
                        selectedItem.kind === "zero" ? "bg-destructive" : "bg-chart-5"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(5, 100 - selectedItem.dropPercent))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Tarjeta 3: Acciones rápidas */}
            <div className="space-y-2 pt-2">
              <Button
                className="w-full gap-2"
                onClick={() => handleSelectAlert(selectedItem)}
                size="default"
                variant="outline"
              >
                <MapPin size={15} />
                Re-centrar en el mapa
              </Button>

              <Button
                className="w-full gap-2"
                onClick={() => {
                  void navigate(`/suministro/${encodeURIComponent(selectedItem.supplyCode)}`, { state: { from: location.pathname } })
                }}
                size="default"
                variant="default"
              >
                <FileText size={15} />
                Ver reporte completo
                <ExternalLink size={13} className="ml-auto" />
              </Button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
