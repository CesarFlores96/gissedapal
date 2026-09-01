import { AlertTriangle, ArrowDown, BarChart3, Building2, Copy, Droplets, ExternalLink, FileText, MapPin, RotateCcw, Search, X } from "lucide-react"
import React, { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { useSession } from "../app/session/sessionContext"
import { AlertsMap } from "../components/AlertsMap"
import { Button } from "../components/ui"
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select"
import {
  appendScan,
  getCachedScan,
  getLastAlertsSearch,
  getVisibleAlertsCount,
  invalidateAlertsScan,
  loadScan,
  setLastAlertsSearch,
  setVisibleAlertsCount,
} from "../features/alerts/dropsCache"
import { useMapData } from "../features/map/mapDataContext"
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
type CategoryFilter = "all" | "grandes_clientes" | "fuente_propia" | "operativo"
type AnalysisScope = "supply" | "property"

const ALERT_FILTERS_STORAGE_KEY = "sedapalgis:alerts:filters:v1"

type AlertsFilters = {
  categoryFilter: CategoryFilter
  filterKind: FilterKind
  searchQuery: string
  district: string
  analysisScope: AnalysisScope
}

function readAlertsFilters(): AlertsFilters {
  const fallback: AlertsFilters = {
    categoryFilter: "all", filterKind: "all", searchQuery: "", district: "", analysisScope: "supply",
  }
  try {
    const stored = window.sessionStorage.getItem(ALERT_FILTERS_STORAGE_KEY)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as Partial<AlertsFilters>
    return {
      categoryFilter: ["all", "grandes_clientes", "fuente_propia", "operativo"].includes(parsed.categoryFilter ?? "")
        ? parsed.categoryFilter as CategoryFilter
        : "all",
      filterKind: ["all", "zero", "extremely_low"].includes(parsed.filterKind ?? "")
        ? parsed.filterKind as FilterKind
        : "all",
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery.slice(0, 160) : "",
      district: typeof parsed.district === "string" ? parsed.district.slice(0, 100) : "",
      analysisScope: parsed.analysisScope === "property" ? "property" : "supply",
    }
  } catch {
    return fallback
  }
}

function alertsCacheKey(
  category: CategoryFilter,
  kind: FilterKind,
  search: string,
  district: string,
  scope: AnalysisScope,
): string {
  return `${scope}|${district}|${category}|${kind}|${search.trim().toLocaleLowerCase("es-PE")}`
}

export function AlertsRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { reportError } = useSession()
  const { districtOptions } = useMapData()
  const [initialState] = useState(() => ({
    filters: readAlertsFilters(),
    appliedSearch: getLastAlertsSearch(),
  }))
  const initialFilters = initialState.filters
  const initialAppliedSearch = initialState.appliedSearch
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(initialFilters.categoryFilter)
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery)
  const [filterKind, setFilterKind] = useState<FilterKind>(initialFilters.filterKind)
  const [district, setDistrict] = useState(initialFilters.district)
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>(initialFilters.analysisScope)
  const [appliedFilters, setAppliedFilters] = useState<AlertsFilters | null>(() => initialAppliedSearch ? {
    categoryFilter: initialAppliedSearch.categoryFilter,
    filterKind: initialAppliedSearch.filterKind,
    searchQuery: initialAppliedSearch.searchQuery,
    district: initialAppliedSearch.district,
    analysisScope: initialAppliedSearch.analysisScope,
  } : null)
  const [data, setData] = useState<ConsumptionDropScan | null>(() => (
    initialAppliedSearch ? getCachedScan(initialAppliedSearch.key) : null
  ))
  const [visibleCount, setVisibleCount] = useState(() => (
    initialAppliedSearch ? getVisibleAlertsCount(initialAppliedSearch.key) : 10
  ))
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<ConsumptionDrop | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  const cacheKey = appliedFilters
    ? alertsCacheKey(
      appliedFilters.categoryFilter, appliedFilters.filterKind, appliedFilters.searchQuery,
      appliedFilters.district, appliedFilters.analysisScope,
    )
    : null
  const classification = appliedFilters?.categoryFilter === "all" ? undefined : appliedFilters?.categoryFilter
  const kind = appliedFilters?.filterKind === "all" ? undefined : appliedFilters?.filterKind

  useEffect(() => {
    window.sessionStorage.setItem(ALERT_FILTERS_STORAGE_KEY, JSON.stringify({
      categoryFilter, filterKind, searchQuery, district, analysisScope,
    }))
  }, [analysisScope, categoryFilter, district, filterKind, searchQuery])

  useEffect(() => {
    if (!appliedFilters || !cacheKey) return
    const cached = getCachedScan(cacheKey)
    if (cached) return
    let active = true
    void Promise.resolve()
      .then(() => {
        if (active) { setLoading(true); setError(null) }
        return loadScan(cacheKey, () => getAbruptConsumptionDrops(
          1, 50, classification, kind, appliedFilters.searchQuery,
          appliedFilters.district, appliedFilters.analysisScope,
        ))
      })
      .then((scan) => {
        if (!active) return
        setData(scan)
      })
      .catch((reason: unknown) => {
        if (!active) return
        if (!reportError(reason)) setError(friendlyError(reason))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [appliedFilters, cacheKey, classification, kind, reportError])

  const filteredItems = data?.items.slice(0, visibleCount) ?? []

  const handleLoadMore = async () => {
    if (!data || !appliedFilters || !cacheKey || loadingMore || visibleCount >= data.total) return
    if (visibleCount < data.items.length) {
      const nextCount = Math.min(visibleCount + 10, data.items.length, data.total)
      setVisibleCount(nextCount)
      setVisibleAlertsCount(cacheKey, nextCount)
      return
    }
    setLoadingMore(true)
    setError(null)
    try {
      const nextPage = (data.page ?? 1) + 1
      const next = await getAbruptConsumptionDrops(
        nextPage, 50, classification, kind, appliedFilters.searchQuery,
        appliedFilters.district, appliedFilters.analysisScope,
      )
      setData({ ...appendScan(cacheKey, next) })
      const nextCount = Math.min(visibleCount + 10, data.total)
      setVisibleCount(nextCount)
      setVisibleAlertsCount(cacheKey, nextCount)
    } catch (reason: unknown) {
      if (!reportError(reason)) setError(friendlyError(reason))
    } finally {
      setLoadingMore(false)
    }
  }

  const clearFilters = () => {
    setSearchQuery("")
    setDistrict("")
    setCategoryFilter("all")
    setFilterKind("all")
  }

  const handleSearch = () => {
    const nextFilters: AlertsFilters = {
      categoryFilter,
      filterKind,
      searchQuery: searchQuery.trim(),
      district,
      analysisScope,
    }
    const nextKey = alertsCacheKey(
      nextFilters.categoryFilter, nextFilters.filterKind, nextFilters.searchQuery,
      nextFilters.district, nextFilters.analysisScope,
    )
    invalidateAlertsScan(nextKey)
    setData(null)
    setVisibleCount(10)
    setSelectedItem(null)
    setError(null)
    setLastAlertsSearch({ key: nextKey, ...nextFilters })
    setAppliedFilters(nextFilters)
  }

  const draftKey = alertsCacheKey(categoryFilter, filterKind, searchQuery, district, analysisScope)
  const filtersPending = appliedFilters !== null && draftKey !== cacheKey

  const activeFilterCount = [searchQuery.trim(), district, categoryFilter !== "all", filterKind !== "all"]
    .filter(Boolean).length

  const handleSelectAlert = (item: ConsumptionDrop) => {
    setSelectedItem(item)
  }

  const handleCopySupplyCode = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true)
      window.setTimeout(() => setCopiedCode(false), 1800)
    })
  }

  return (
    <div className="relative flex h-full w-full justify-between overflow-hidden pointer-events-none">
      <AlertsMap
        alerts={filteredItems}
        loading={loading}
        onSelect={handleSelectAlert}
        resultKey={cacheKey}
        selectedAlert={selectedItem}
      />

      {/* Panel Lateral Izquierdo: Lista de Alertas */}
      <aside className="pointer-events-auto flex h-full w-[380px] md:w-[420px] max-w-[calc(100%-1rem)] flex-col border-r bg-background/95 shadow-xl backdrop-blur shrink-0 z-10">
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
                {filteredItems.length} de {data.total}
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border bg-muted/30 p-1">
            <div className="grid grid-cols-2 gap-1">
              {(["supply", "property"] as const).map((scope) => (
                <button
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-all ${
                    analysisScope === scope
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  }`}
                  key={scope}
                  onClick={() => setAnalysisScope(scope)}
                  type="button"
                >
                  {scope === "supply" ? <Droplets size={13} /> : <Building2 size={13} />}
                  {scope === "supply" ? "Por suministro" : "Por cliente y lote"}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {analysisScope === "supply"
              ? "Cada NIS se compara con la mediana de sus 3 meses anteriores."
              : "Suma los NIS del mismo cliente y lote, y compara el total con su mediana histórica."}
          </p>

          <label className="block space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Buscar por NIS o nombre del cliente
            </span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border bg-background pl-8 pr-8 text-xs text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSearch()
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ej. 1234567 o Juan Pérez"
                type="search"
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
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Distrito</span>
              <NativeSelect className="w-full" onChange={(event) => setDistrict(event.target.value)} value={district}>
                <NativeSelectOption value="">Todos los distritos</NativeSelectOption>
                {districtOptions.map((option) => (
                  <NativeSelectOption key={option.code ?? option.name} value={option.name}>{option.name}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipo de cliente</span>
              <NativeSelect className="w-full" onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)} value={categoryFilter}>
                <NativeSelectOption value="all">Todos los clientes</NativeSelectOption>
                <NativeSelectOption value="grandes_clientes">Grandes Clientes</NativeSelectOption>
                <NativeSelectOption value="fuente_propia">Fuente Propia</NativeSelectOption>
                <NativeSelectOption value="operativo">Otros clientes</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipo de alerta</span>
              <NativeSelect className="w-full" onChange={(event) => setFilterKind(event.target.value as FilterKind)} value={filterKind}>
                <NativeSelectOption value="all">Todas las alertas</NativeSelectOption>
                <NativeSelectOption value="zero">Consumo cero</NativeSelectOption>
                <NativeSelectOption value="extremely_low">Caída fuerte</NativeSelectOption>
              </NativeSelect>
            </label>
          </div>

          {activeFilterCount > 0 ? (
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-[11px] text-muted-foreground">
                {activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}
              </span>
              <button className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline" onClick={clearFilters} type="button">
                <RotateCcw size={12} /> Limpiar filtros
              </button>
            </div>
          ) : null}

          <Button
            className="h-9 w-full gap-2"
            disabled={loading}
            onClick={handleSearch}
            size="sm"
          >
            <Search size={14} />
            {loading ? "Buscando alertas…" : filtersPending ? "Aplicar nuevos filtros" : "Buscar alertas"}
          </Button>
        </div>

        {/* Lista compacta de Alertas */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div aria-busy="true" className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div className="h-16 animate-pulse rounded-md bg-muted" key={item} />
              ))}
            </div>
          ) : error && !data?.items.length ? (
            <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : filteredItems.length ? (
            <>
              {filteredItems.map((item) => {
              const isSelected = selectedItem?.supplyCode === item.supplyCode
              const isPropertyGroup = item.analysisScope === "property"
              const groupSupplyCount = item.supplyCount ?? 1
              const groupSupplyCodes = item.supplyCodes?.length ? item.supplyCodes : [item.supplyCode]
              const propertyCode = item.propertyCode?.replace(/^(cup|lot):/i, "") ?? "Sin código"
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
                        <p className="font-semibold text-foreground truncate">
                          {isPropertyGroup ? item.customerName ?? "Cliente no registrado" : item.supplyCode}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {isPropertyGroup
                            ? `Lote ${propertyCode} · ${groupSupplyCount} NIS`
                            : item.customerName ?? "Cliente no registrado"}
                        </p>
                        {isPropertyGroup ? (
                          <div className="mt-1 flex flex-wrap gap-1" aria-label={`NIS del lote: ${groupSupplyCodes.join(", ")}`}>
                            {groupSupplyCodes.map((code) => (
                              <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground" key={code}>
                                {code}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                            {item.classification ?? "Operativo"}
                          </span>
                          {isPropertyGroup && groupSupplyCount > 1 ? (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                              Grupo consolidado
                            </span>
                          ) : null}
                        </div>
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
                      {isPropertyGroup ? "Ver lote en el mapa" : "Ver en el mapa"}
                    </Button>
                  </div>
                </div>
              )
              })}
              {loadingMore ? (
                <div aria-live="polite" className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
                  <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
                  Cargando más alertas… ({data?.items.length ?? 0} de {data?.total ?? 0})
                </div>
              ) : data && filteredItems.length < data.total ? (
                <Button className="w-full" onClick={() => void handleLoadMore()} size="sm" variant="outline">
                  Cargar 10 más ({filteredItems.length} de {data.total})
                </Button>
              ) : null}
              {error ? <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
            </>
          ) : !appliedFilters ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center">
              <Search aria-hidden="true" className="mx-auto mb-3 text-muted-foreground" size={22} />
              <p className="text-xs font-semibold">Configura los filtros para comenzar</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                La consulta se ejecutará únicamente cuando selecciones Buscar alertas.
              </p>
            </div>
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
                <h2 className="text-sm font-semibold truncate">
                  {selectedItem.analysisScope === "property" ? "Detalle del cliente y lote" : "Detalle del suministro"}
                </h2>
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
                <span className="text-muted-foreground font-medium">
                  {selectedItem.analysisScope === "property" ? "Ficha consolidada del lote" : "Ficha del suministro"}
                </span>
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
                  <span className="text-[11px] text-muted-foreground block">
                    {selectedItem.analysisScope === "property" ? "NIS representante:" : "NIS / Código:"}
                  </span>
                  <span className="font-mono text-sm font-bold text-foreground">{selectedItem.supplyCode}</span>
                </div>

                {selectedItem.analysisScope === "property" ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-2">
                    <span className="text-[11px] font-medium text-primary">
                      Consumo consolidado de {selectedItem.supplyCount ?? 1} NIS del mismo cliente y lote
                    </span>
                    <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">
                      {(selectedItem.supplyCodes?.length ? selectedItem.supplyCodes : [selectedItem.supplyCode]).join(", ")}
                    </p>
                  </div>
                ) : null}

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
                    <span className="text-[10px] text-muted-foreground block">Mediana 3 meses previos:</span>
                    <span className="text-sm font-semibold text-foreground">{volume(selectedItem.referenceVolume)}</span>
                  </div>
                </div>

                {(selectedItem.supplyCount ?? 1) > 1 ? (
                  <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-[11px]">
                    <span className="text-muted-foreground">Promedio por NIS:</span>
                    <span className="font-semibold text-foreground">
                      {volume(selectedItem.averageCurrentVolume ?? 0)} vs {volume(selectedItem.averageReferenceVolume ?? 0)}
                    </span>
                  </div>
                ) : null}

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
                onClick={() => setSelectedItem({ ...selectedItem })}
                size="default"
                variant="outline"
              >
                <MapPin size={15} />
                Re-centrar en el mapa
              </Button>

              <Button
                className="w-full gap-2"
                onClick={() => {
                  if (selectedItem.analysisScope === "property") {
                    const codes = selectedItem.supplyCodes ?? [selectedItem.supplyCode]
                    const query = new URLSearchParams(codes.map((code) => ["nis", code]))
                    const propertyCode = selectedItem.propertyCode ?? selectedItem.supplyCode
                    void navigate(`/cliente-lote/${encodeURIComponent(propertyCode)}?${query.toString()}`, {
                      state: { from: location.pathname },
                    })
                    return
                  }
                  void navigate(`/suministro/${encodeURIComponent(selectedItem.supplyCode)}`, {
                    state: { from: location.pathname },
                  })
                }}
                size="default"
                variant="default"
              >
                <FileText size={15} />
                {selectedItem.analysisScope === "property" ? "Ver reporte consolidado" : "Ver reporte completo"}
                <ExternalLink size={13} className="ml-auto" />
              </Button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
