import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useSession } from "../../app/session/sessionContext"
import { friendlyError } from "../../lib/errors"
import { fetchDistricts, fetchGisLayers } from "../../lib/ipc"
import type { CadastralSelection, DistrictOption, GisLayersResponse, LayerKey, LayerMeta } from "../../types"
import { coverageKey, isAreaCovered, rememberArea, takeDistrictReset } from "./coverageCache"
import { applySavedCorrection, bboxContains, mergeResponses } from "./geometry"
import { INITIAL_LAYERS, takeInitialLayersPreload } from "./initialPreload"
import { MapDataContext } from "./mapDataContext"

// "distritos" viene activo porque el enfoque de cámara y el atenuado del resto
// del mapa se apoyan en esa capa; sin ella el filtro de distrito no tiene efecto
// visual.
const initialLayers = new Set<LayerKey>(INITIAL_LAYERS)

// Cota de seguridad de la paginación: 2 000 features por página, así que son hasta
// 40 000 por capa. Lotes grandes reducen viajes IPC sin renderizar por cada página.
const MAX_PAGES = 20
const minimumLayerZoom: Partial<Record<LayerKey, number>> = {
  manzanas: 13,
  lotes: 15,
}

export function MapDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { reportError } = useSession()
  const [activeLayers, setActiveLayers] = useState(initialLayers)
  // El splash (SessionProvider) precarga la página 1 de estas mismas capas con un
  // bbox amplio de Lima mientras se ve la pantalla de arranque; acá sólo se
  // consume ese adelanto para no arrancar en blanco. El fetch real del viewport
  // llega igual apenas el mapa reporta sus bounds y reemplaza esta página 1.
  const [mapData, setMapData] = useState<GisLayersResponse | null>(() => takeInitialLayersPreload())
  const [loading, setLoading] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [threeDimensional, setThreeDimensional] = useState(false)
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictOption | null>(null)
  const [districtOptions, setDistrictOptions] = useState<DistrictOption[]>([])
  const [searching, setSearching] = useState(false)

  const requestSequence = useRef(0)
  const pendingTimer = useRef<number | null>(null)
  const lastView = useRef<{ bbox: [number, number, number, number]; zoom: number } | null>(null)
  const lastLoadedView = useRef<{ bbox: [number, number, number, number]; scope: string; zoom: number } | null>(null)

  useEffect(() => {
    let active = true
    void fetchDistricts()
      .then((districts) => {
        if (!active) return
        setDistrictOptions([...districts].sort((left, right) => {
          const codeOrder = (left.code ?? "").localeCompare(right.code ?? "", "es", { numeric: true })
          return codeOrder || left.name.localeCompare(right.name, "es")
        }))
      })
      .catch((error) => { if (active) setMapError(friendlyError(error)) })
    return () => { active = false }
  }, [])

  const loadBounds = useCallback(async (bbox: [number, number, number, number], zoom: number): Promise<void> => {
    const sequence = ++requestSequence.current
    // Evita pedir o contar catastro antes de que pueda dibujarse. Consultar
    // lotes a escala Lima bloqueaba el arranque sin aportar geometría visible.
    const layers = [...activeLayers].filter((layer) => zoom >= (minimumLayerZoom[layer] ?? 0))
    if (!layers.length) return
    const scope = `${selectedDistrict?.name ?? "__all_districts__"}:${[...layers].sort().join(",")}`
    const supplyOnlyLayers = layers.every((layer) => layer === "distritos" || layer === "suministros")
    const cacheKey = coverageKey(selectedDistrict?.name)
    const loadedView = lastLoadedView.current
    if (loadedView?.scope === scope && loadedView.zoom >= zoom && bboxContains(loadedView.bbox, bbox)) {
      setLoading(false)
      return
    }
    // La fuente del mapa conserva los puntos recibidos. Si el encuadre completo
    // ya estaba en una zona descargada, evitamos incluso el viaje IPC/API.
    if (supplyOnlyLayers && isAreaCovered(cacheKey, bbox, bboxContains)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMapError(null)
    try {
      let page = 1
      let pagedLayers: LayerKey[] = layers
      // La primera página se pinta enseguida; el resto se acumula y se vuelca de
      // una sola vez para no forzar un setData completo de MapLibre por página.
      let buffered: GisLayersResponse | null = null
      while (pagedLayers.length > 0 && page <= MAX_PAGES && sequence === requestSequence.current) {
        const response = await fetchGisLayers({
          bbox,
          layers: pagedLayers,
          page,
          pageSize: 2000,
          zoom,
          district: selectedDistrict?.name ?? undefined,
        })
        if (sequence !== requestSequence.current) return
        if (page === 1) {
          // Al navegar conservamos los NIS ya recibidos y unimos sólo los nuevos.
          // La excepción es cambiar el filtro distrital, cuya colección sí cambia.
          const resetSupplies = takeDistrictReset(selectedDistrict?.name ?? null)
          setMapData((current) => mergeResponses(current, response, resetSupplies))
          buffered = null
        } else {
          buffered = mergeResponses(buffered, response, false)
        }
        pagedLayers = Object.entries(response.layers)
          .filter(([, layer]) => layer?.meta.hasMore)
          .map(([key]) => key as LayerKey)
        page += 1
      }
      if (buffered && sequence === requestSequence.current) {
        const pending = buffered
        setMapData((current) => mergeResponses(current, pending, false))
      }
      if (sequence === requestSequence.current) lastLoadedView.current = { bbox, scope, zoom }
      if (pagedLayers.length === 0 && sequence === requestSequence.current && supplyOnlyLayers) {
        rememberArea(cacheKey, bbox)
      }
    } catch (error) {
      if (sequence === requestSequence.current && !reportError(error)) {
        setMapError(friendlyError(error))
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [activeLayers, reportError, selectedDistrict])

  const handleBoundsChange = useCallback((bbox: [number, number, number, number], zoom: number): void => {
    lastView.current = { bbox, zoom }
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
    pendingTimer.current = window.setTimeout(() => { void loadBounds(bbox, zoom) }, 280)
  }, [loadBounds])

  useEffect(() => () => {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
  }, [])

  useEffect(() => {
    if (lastView.current) void loadBounds(lastView.current.bbox, lastView.current.zoom)
  }, [activeLayers, loadBounds, selectedDistrict])

  const layerMeta = useMemo(() => {
    const result: Partial<Record<LayerKey, LayerMeta>> = {}
    for (const [key, payload] of Object.entries(mapData?.layers ?? {})) {
      if (payload) result[key as LayerKey] = { ...payload.meta, total: payload.data.features.length || payload.meta.total }
    }
    return result
  }, [mapData])

  const toggleLayer = useCallback((layer: LayerKey): void => {
    setActiveLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const addLayers = useCallback((layers: LayerKey[]): void => {
    setActiveLayers((current) => {
      if (layers.every((layer) => current.has(layer))) return current
      return new Set([...current, ...layers])
    })
  }, [])

  const applyCorrection = useCallback((
    selection: CadastralSelection,
    lng: number,
    lat: number,
    savedLng: number,
    savedLat: number,
  ): void => {
    setMapData((current) => applySavedCorrection(current, selection, lng, lat, savedLng, savedLat))
  }, [])

  const reloadLastView = useCallback((): void => {
    if (lastView.current) void loadBounds(lastView.current.bbox, lastView.current.zoom)
  }, [loadBounds])

  const toggleThreeDimensional = useCallback(() => setThreeDimensional((value) => !value), [])

  const mapViewProps = useMemo(() => ({
    activeLayers,
    data: mapData,
    districts: districtOptions,
    onBoundsChange: handleBoundsChange,
    onError: setMapError,
    selectedDistrict,
    threeDimensional,
  }), [activeLayers, mapData, districtOptions, handleBoundsChange, selectedDistrict, threeDimensional])

  const value = useMemo(() => ({
    activeLayers,
    districtOptions,
    layerMeta,
    loading,
    mapError,
    searching,
    selectedDistrict,
    threeDimensional,
    mapViewProps,
    addLayers,
    applyCorrection,
    reloadLastView,
    setMapError,
    setSearching,
    selectDistrict: setSelectedDistrict,
    toggleLayer,
    toggleThreeDimensional,
  }), [
    activeLayers, districtOptions, layerMeta, loading, mapError, searching, selectedDistrict,
    threeDimensional, mapViewProps, addLayers, applyCorrection, reloadLastView, toggleLayer,
    toggleThreeDimensional,
  ])

  return <MapDataContext value={value}>{children}</MapDataContext>
}
