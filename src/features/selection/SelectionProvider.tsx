import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useSession } from "../../app/session/sessionContext"
import { friendlyError } from "../../lib/errors"
import * as ipc from "../../lib/ipc"
import type { BuildingFootprint, CadastralSelection, CadastreSearchResult, LotSplitSuggestion, PlaceLocation, PlaceSuggestion, RelationshipResult, SupplyDetail, SupplyFocusPoint } from "../../types"
import { estimateLotBbox } from "../map/geometry"
import { useMapData } from "../map/mapDataContext"
import { SelectionContext } from "./selectionContext"
import {
  cacheConsumption,
  cacheDetail,
  forgetPendingDetail,
  getCachedConsumption,
  getCachedDetail,
  getPendingDetail,
  trackDetailRequest,
} from "./supplyCaches"

function buildPreviewDetail(preview: Partial<SupplyDetail> & { supply: SupplyDetail["supply"] }): SupplyDetail {
  return {
    supply: preview.supply,
    geometry: preview.geometry ?? null,
    meter: preview.meter ?? null,
    hierarchy: preview.hierarchy ?? {
      district: null,
      quadrant: null,
      lot: null,
      provisional: true,
      geometryAvailable: Boolean(preview.geometry),
    },
    cadastre: preview.cadastre ?? null,
    cadastralLink: preview.cadastralLink ?? null,
    consumption: preview.consumption ?? null,
    consumptionLoading: preview.consumptionLoading ?? false,
  }
}

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { isReadOnly, reportError } = useSession()
  const { addLayers, applyCorrection, reloadLastView, selectDistrict, setMapError, setSearching } = useMapData()

  const [selectedSupply, setSelectedSupply] = useState<SupplyDetail | null>(null)
  const [focusedSupplyGroup, setFocusedSupplyGroup] = useState<SupplyFocusPoint[]>([])
  const [resolvedLocation, setResolvedLocation] = useState<RelationshipResult | null>(null)
  const [resolvedLocationPoint, setResolvedLocationPoint] = useState<{ lng: number; lat: number } | null>(null)
  const [cadastralSelection, setCadastralSelection] = useState<CadastralSelection | null>(null)
  const [focusedPlace, setFocusedPlace] = useState<PlaceLocation | null>(null)
  const [placeFocusToken, setPlaceFocusToken] = useState(0)
  const [inspectorLoading, setInspectorLoading] = useState(false)
  const [selectionFocusBehavior, setSelectionFocusBehavior] = useState<"auto" | "preserve">("auto")
  const [supplyFocusToken, setSupplyFocusToken] = useState(0)
  const [adjustmentMode, setAdjustmentMode] = useState(false)
  const [adjustmentDelta, setAdjustmentDelta] = useState({ lng: 0, lat: 0 })
  const [adjustmentSaving, setAdjustmentSaving] = useState(false)
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null)
  const [buildingFootprint, setBuildingFootprint] = useState<BuildingFootprint | null>(null)
  const [buildingFootprintDraft, setBuildingFootprintDraft] = useState<[number, number][]>([])
  const [buildingDigitizationMode, setBuildingDigitizationMode] = useState(false)
  const [buildingFootprintSaving, setBuildingFootprintSaving] = useState(false)
  const [buildingFootprintNotice, setBuildingFootprintNotice] = useState<string | null>(null)
  const [lotSplitMode, setLotSplitMode] = useState(false)
  const [lotSplitDraftLine, setLotSplitDraftLine] = useState<[number, number][]>([])
  const [lotSplitSuggestion, setLotSplitSuggestion] = useState<LotSplitSuggestion | null>(null)
  const [lotSplitLoadingSuggestion, setLotSplitLoadingSuggestion] = useState(false)
  const [lotSplitSaving, setLotSplitSaving] = useState(false)
  const [lotSplitNotice, setLotSplitNotice] = useState<string | null>(null)
  const preserveAdjustmentModeRef = useRef(false)

  useEffect(() => {
    if (!cadastralSelection) return
    // El reset vive en la función de retorno (se dispara al cambiar o limpiar
    // la selección) en vez de en el cuerpo del efecto, para no llamar a
    // setState de forma síncrona dentro de él.
    return () => {
      if (preserveAdjustmentModeRef.current) {
        preserveAdjustmentModeRef.current = false
        return
      }
      setAdjustmentMode(false)
      setAdjustmentDelta({ lng: 0, lat: 0 })
      setBuildingDigitizationMode(false)
      setBuildingFootprintDraft([])
      setLotSplitMode(false)
      setLotSplitDraftLine([])
      setLotSplitSuggestion(null)
      setLotSplitNotice(null)
    }
  }, [cadastralSelection])

  useEffect(() => {
    if (!cadastralSelection || cadastralSelection.kind !== "lot") {
      return
    }
    let active = true
    void ipc.getBuildingFootprint(cadastralSelection.id)
      .then((footprint) => {
        if (active) setBuildingFootprint(footprint)
      })
      .catch((error) => {
        if (active && !reportError(error)) setMapError(friendlyError(error))
      })
    return () => { active = false }
  }, [cadastralSelection, reportError, setMapError])

  const getSupplyDetailCached = useCallback(async (supplyCode: string): Promise<SupplyDetail> => {
    const normalized = supplyCode.trim()
    const cached = getCachedDetail(normalized)
    if (cached) return cached

    const pending = getPendingDetail(normalized)
    if (pending) return pending

    const request = ipc.getSupplyDetail(normalized)
      .then((detail) => {
        cacheDetail(normalized, detail)
        return detail
      })
      .finally(() => {
        forgetPendingDetail(normalized)
      })

    trackDetailRequest(normalized, request)
    return request
  }, [])

  const loadSupplyConsumption = useCallback((detail: SupplyDetail): void => {
    const supplyCode = detail.supply.code
    const cached = getCachedConsumption(supplyCode)
    if (cached !== undefined) {
      setSelectedSupply((current) => current?.supply.code === supplyCode ? { ...current, consumption: cached, consumptionLoading: false } : current)
      return
    }
    void ipc.getSupplyConsumption(supplyCode)
      .then((consumption) => {
        cacheConsumption(supplyCode, consumption)
        setSelectedSupply((current) => current?.supply.code === supplyCode ? { ...current, consumption, consumptionLoading: false } : current)
      })
      .catch(() => {
        // La ficha base sigue siendo útil aunque la agregación de facturación falle.
        setSelectedSupply((current) => current?.supply.code === supplyCode ? { ...current, consumptionLoading: false } : current)
      })
  }, [])

  const resetSelection = useCallback((): void => {
    setSelectedSupply(null)
    setFocusedSupplyGroup([])
    setResolvedLocation(null)
    setResolvedLocationPoint(null)
    setAdjustmentMode(false)
    setCadastralSelection(null)
    setFocusedPlace(null)
  }, [])

  const selectSupply = useCallback(async (
    supplyCode: string,
    preview?: Partial<SupplyDetail> | null,
    group: SupplyFocusPoint[] = [],
  ): Promise<void> => {
    setInspectorLoading(true)
    setSelectionFocusBehavior("auto")
    setResolvedLocation(null)
    setAdjustmentMode(false)
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setAdjustmentNotice(null)
    setCadastralSelection(null)
    setFocusedPlace(null)
    setFocusedSupplyGroup(group)
    if (preview?.supply) {
      setSelectedSupply(buildPreviewDetail(preview as Partial<SupplyDetail> & { supply: SupplyDetail["supply"] }))
      setSupplyFocusToken((current) => current + 1)
    } else {
      setSelectedSupply(null)
    }
    try {
      const detail = await getSupplyDetailCached(supplyCode)
      setSelectedSupply(detail)
      if (!preview?.supply) setSupplyFocusToken((current) => current + 1)
      loadSupplyConsumption(detail)
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setInspectorLoading(false)
    }
  }, [getSupplyDetailCached, loadSupplyConsumption, reportError, setMapError])

  const searchSupply = useCallback(async (supplyCode: string): Promise<void> => {
    setSearching(true)
    setMapError(null)
    resetSelection()
    // Buscar un NIS no debe conservar ni derivar un filtro distrital de datos.
    selectDistrict(null)
    try {
      const detail = await getSupplyDetailCached(supplyCode)
      setSelectedSupply(detail)
      setSupplyFocusToken((current) => current + 1)
      loadSupplyConsumption(detail)
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setSearching(false)
    }
  }, [getSupplyDetailCached, loadSupplyConsumption, reportError, resetSelection, selectDistrict, setMapError, setSearching])

  const selectMapLocation = useCallback((lng: number, lat: number): void => {
    void (async () => {
      setInspectorLoading(true)
      resetSelection()
      // Se guarda aunque no haya lote/suministro cerca: es lo único que le
      // permite a MapsActions abrir Street View sobre un punto "vacío" del mapa.
      setResolvedLocationPoint({ lng, lat })
      try {
        const relation = await ipc.resolveLocation(lng, lat)
        setResolvedLocation(relation)
        if (relation.supply?.supplyCode) {
          const detail = await getSupplyDetailCached(relation.supply.supplyCode)
          setSelectedSupply(detail)
          setSupplyFocusToken((current) => current + 1)
          loadSupplyConsumption(detail)
        }
      } catch (error) {
        if (!reportError(error)) setMapError(friendlyError(error))
      } finally {
        setInspectorLoading(false)
      }
    })()
  }, [getSupplyDetailCached, loadSupplyConsumption, reportError, resetSelection, setMapError])

  // Estables entre renders: MapView está memoizado y una lambda nueva por render
  // lo obligaría a re-renderizar con cada cambio de estado de la selección.
  const selectMapCadastral = useCallback((selection: CadastralSelection): void => {
    // La selección directa ocurre sobre una geometría ya visible, así que la
    // cámara debe conservar el encuadre actual en vez de re-enfocar.
    setSelectionFocusBehavior("preserve")
    setAdjustmentMode(false)
    setAdjustmentDelta({ lng: 0, lat: 0 })
    if (selection.kind === "block") addLayers(["lotes"])
    setCadastralSelection(selection)
    setSelectedSupply(null)
    setFocusedSupplyGroup([])
    setResolvedLocation(null)
    setFocusedPlace(null)
  }, [addLayers])

  const searchCadastre = useCallback(async (query: string): Promise<CadastreSearchResult[]> => {
    setMapError(null)
    try {
      return await ipc.searchCadastre(query)
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
      return []
    }
  }, [reportError, setMapError])

  const selectCadastreResult = useCallback((result: CadastreSearchResult): void => {
    setSelectionFocusBehavior("auto")
    setAdjustmentMode(false)
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setCadastralSelection(result)
    setSelectedSupply(null)
    setFocusedSupplyGroup([])
    setResolvedLocation(null)
    setFocusedPlace(null)
    selectDistrict(null)
    addLayers(["lotes", ...(result.kind === "block" ? ["manzanas" as const] : [])])
  }, [addLayers, selectDistrict])

  const searchPlaces = useCallback(async (
    query: string,
    near?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> => {
    try {
      return await ipc.searchPlaces(query, near)
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
      return []
    }
  }, [reportError, setMapError])

  const selectPlace = useCallback(async (
    suggestion: PlaceSuggestion,
    near?: { lat: number; lng: number },
  ): Promise<void> => {
    setMapError(null)
    try {
      const place = await ipc.resolvePlace(suggestion.label, suggestion.placeId, near)
      if (!place) {
        setMapError(`No se pudo ubicar "${suggestion.label}".`)
        return
      }
      setSelectionFocusBehavior("auto")
      setAdjustmentMode(false)
      setAdjustmentDelta({ lng: 0, lat: 0 })
      setCadastralSelection(null)
      setSelectedSupply(null)
      setFocusedSupplyGroup([])
      setResolvedLocation(null)
      selectDistrict(null)
      setFocusedPlace(place)
      setPlaceFocusToken((current) => current + 1)
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    }
  }, [reportError, selectDistrict, setMapError])

  // Salta del inspector de un suministro al lote catastral real que lo contiene.
  // `cadastralLink` viene resuelto espacialmente en el backend (distinto del
  // lot_code textual de facturación), así que se busca por su código exacto en
  // catastro para obtener la geometría y poder encuadrarla, igual que hace
  // startAdjustment con la manzana de un lote.
  const viewSupplyCadastre = useCallback(async (link: { code: string | null }): Promise<void> => {
    if (!link.code) return
    const results = await searchCadastre(link.code)
    const match = results.find((result) => result.kind === "lot" && result.code === link.code)
    if (!match) {
      setMapError(`No se encontró el lote ${link.code} en catastro.`)
      return
    }
    setSelectionFocusBehavior("auto")
    setAdjustmentMode(false)
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setCadastralSelection(match)
    setSelectedSupply(null)
    setResolvedLocation(null)
    setFocusedPlace(null)
    addLayers(["lotes"])
  }, [addLayers, searchCadastre, setMapError])

  const startAdjustment = useCallback(async (target: "selection" | "block"): Promise<void> => {
    if (isReadOnly || !cadastralSelection) return
    setLotSplitMode(false)
    setLotSplitDraftLine([])
    setBuildingDigitizationMode(false)
    if (target === "selection" || cadastralSelection.kind === "block") {
      setAdjustmentNotice(null)
      setAdjustmentDelta({ lng: 0, lat: 0 })
      setAdjustmentMode(true)
      return
    }

    const blockCode = cadastralSelection.properties.block_code
    if (typeof blockCode !== "string" || !blockCode.trim()) {
      setMapError("El lote no tiene una manzana asociada.")
      return
    }
    const results = await searchCadastre(blockCode)
    const block = results.find((result) => result.kind === "block" && result.code === blockCode)
    if (!block) {
      setMapError(`No se encontró la manzana ${blockCode}.`)
      return
    }
    setSelectionFocusBehavior("preserve")
    setAdjustmentMode(false)
    preserveAdjustmentModeRef.current = true
    setCadastralSelection(block)
    setSelectedSupply(null)
    setResolvedLocation(null)
    selectDistrict(null)
    addLayers(["manzanas", "lotes"])
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setAdjustmentNotice(null)
    // La selección de la manzana dispara el cleanup de la selección anterior;
    // activar el modo en el siguiente tick evita que ese reset lo sobrescriba.
    window.setTimeout(() => setAdjustmentMode(true), 0)
  }, [addLayers, cadastralSelection, isReadOnly, searchCadastre, selectDistrict, setMapError])

  const nudgeAdjustment = useCallback((eastMeters: number, northMeters: number): void => {
    const latitude = cadastralSelection?.center?.[1] ?? -12.046374
    const longitudeDegrees = eastMeters / (111_320 * Math.cos(latitude * Math.PI / 180))
    const latitudeDegrees = northMeters / 111_320
    setAdjustmentDelta((current) => ({ lng: current.lng + longitudeDegrees, lat: current.lat + latitudeDegrees }))
  }, [cadastralSelection])

  const cancelAdjustment = useCallback((): void => {
    setAdjustmentMode(false)
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setAdjustmentNotice(null)
  }, [])

  const startBuildingDigitization = useCallback((): void => {
    if (isReadOnly || !cadastralSelection || cadastralSelection.kind !== "lot") return
    setAdjustmentMode(false)
    setLotSplitMode(false)
    setLotSplitDraftLine([])
    setBuildingFootprintDraft([])
    setBuildingFootprintNotice(null)
    setBuildingDigitizationMode(true)
  }, [cadastralSelection, isReadOnly])

  const addBuildingFootprintPoint = useCallback((lng: number, lat: number): void => {
    if (!buildingDigitizationMode) return
    setBuildingFootprintDraft((current) => [...current, [lng, lat]])
  }, [buildingDigitizationMode])

  const cancelBuildingDigitization = useCallback((): void => {
    setBuildingDigitizationMode(false)
    setBuildingFootprintDraft([])
    setBuildingFootprintNotice(null)
  }, [])

  const persistBuildingFootprint = useCallback(async (): Promise<void> => {
    if (isReadOnly || !cadastralSelection || cadastralSelection.kind !== "lot") return
    if (buildingFootprintDraft.length < 3) {
      setBuildingFootprintNotice("Marca al menos tres esquinas de la construccion.")
      return
    }
    const first = buildingFootprintDraft[0]
    const last = buildingFootprintDraft[buildingFootprintDraft.length - 1]
    const ring = last[0] === first[0] && last[1] === first[1]
      ? buildingFootprintDraft
      : [...buildingFootprintDraft, first]
    setBuildingFootprintSaving(true)
    setMapError(null)
    try {
      const saved = await ipc.saveBuildingFootprint(cadastralSelection.id, {
        type: "Polygon",
        coordinates: [ring],
      })
      setBuildingFootprint(saved)
      setBuildingDigitizationMode(false)
      setBuildingFootprintDraft([])
      setBuildingFootprintNotice("Huella propia guardada y aplicada al modelo 3D.")
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setBuildingFootprintSaving(false)
    }
  }, [buildingFootprintDraft, cadastralSelection, isReadOnly, reportError, setMapError])

  const activeBuildingFootprint = cadastralSelection?.kind === "lot"
    && buildingFootprint?.lotId === cadastralSelection.id
    ? buildingFootprint
    : null

  // Si el lote seleccionado es en realidad un sub-lote de una división ya
  // guardada, gis_lots_effective expone `parent_lot_id` en sus propiedades
  // (ver fetch_lot_layer/fetch_corrected_lot_tile en el backend). Sirve para
  // ofrecer "Deshacer división" sin tener que pedirle el id al usuario.
  const activeLotSplitParentId = cadastralSelection?.kind === "lot"
    ? (cadastralSelection.properties.parent_lot_id as string | null | undefined) ?? null
    : null

  const startLotSplit = useCallback((): void => {
    if (isReadOnly || !cadastralSelection || cadastralSelection.kind !== "lot" || activeLotSplitParentId) return
    setAdjustmentMode(false)
    setBuildingDigitizationMode(false)
    setLotSplitDraftLine([])
    setLotSplitSuggestion(null)
    setLotSplitNotice(null)
    setLotSplitMode(true)

    const center = cadastralSelection.center
    const areaM2 = Number(cadastralSelection.properties.area_m2)
    if (!center || !Number.isFinite(areaM2) || areaM2 <= 0) return
    setLotSplitLoadingSuggestion(true)
    const bbox = estimateLotBbox(center, areaM2)
    void ipc.suggestLotSplit(bbox)
      .then((suggestion) => {
        setLotSplitSuggestion(suggestion)
        setLotSplitDraftLine(suggestion.suggestedLine.map(([lng, lat]) => [lng, lat] as [number, number]))
      })
      .catch(() => {
        // La sugerencia es una ayuda opcional (Ollama puede no estar
        // configurado, o fallar): el usuario igual puede marcar la línea a mano.
        setLotSplitNotice("No se pudo sugerir una línea automáticamente. Marca los dos puntos en el mapa.")
      })
      .finally(() => setLotSplitLoadingSuggestion(false))
  }, [activeLotSplitParentId, cadastralSelection, isReadOnly])

  const addLotSplitPoint = useCallback((lng: number, lat: number): void => {
    if (!lotSplitMode) return
    setLotSplitDraftLine((current) => current.length < 2 ? [...current, [lng, lat]] : [current[0], [lng, lat]])
  }, [lotSplitMode])

  const cancelLotSplit = useCallback((): void => {
    setLotSplitMode(false)
    setLotSplitDraftLine([])
    setLotSplitSuggestion(null)
    setLotSplitNotice(null)
  }, [])

  const persistLotSplit = useCallback(async (): Promise<void> => {
    if (isReadOnly || !cadastralSelection || cadastralSelection.kind !== "lot") return
    if (lotSplitDraftLine.length < 2) {
      setLotSplitNotice("Marca los dos puntos de la línea divisoria.")
      return
    }
    setLotSplitSaving(true)
    setMapError(null)
    try {
      await ipc.saveLotSplit(cadastralSelection.id, [lotSplitDraftLine[0], lotSplitDraftLine[1]])
      setLotSplitMode(false)
      setLotSplitDraftLine([])
      setLotSplitSuggestion(null)
      setLotSplitNotice(null)
      // El lote seleccionado deja de existir como tal en gis_lots_effective
      // (lo reemplazan sus 2 sub-lotes): se limpia la selección y se recarga
      // la vista para que el mapa traiga las geometrías nuevas.
      setCadastralSelection(null)
      reloadLastView()
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setLotSplitSaving(false)
    }
  }, [cadastralSelection, isReadOnly, lotSplitDraftLine, reloadLastView, reportError, setMapError])

  const undoLotSplit = useCallback(async (): Promise<void> => {
    if (isReadOnly || !activeLotSplitParentId) return
    setLotSplitSaving(true)
    setMapError(null)
    try {
      await ipc.resetLotSplit(activeLotSplitParentId)
      setCadastralSelection(null)
      reloadLastView()
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setLotSplitSaving(false)
    }
  }, [activeLotSplitParentId, isReadOnly, reloadLastView, reportError, setMapError])

  const persistAdjustment = useCallback(async (reset: boolean): Promise<void> => {
    if (isReadOnly || !cadastralSelection) return
    setAdjustmentSaving(true)
    setMapError(null)
    const currentLng = Number(cadastralSelection.properties.correction_lng) || 0
    const currentLat = Number(cadastralSelection.properties.correction_lat) || 0
    const nextLng = reset ? 0 : currentLng + adjustmentDelta.lng
    const nextLat = reset ? 0 : currentLat + adjustmentDelta.lat
    try {
      const saved = await ipc.saveGeometryCorrection({
        targetKind: cadastralSelection.kind,
        targetId: cadastralSelection.id,
        deltaLng: nextLng,
        deltaLat: nextLat,
        reset,
      })
      const appliedDeltaLng = saved.deltaLng - currentLng
      const appliedDeltaLat = saved.deltaLat - currentLat
      applyCorrection(
        cadastralSelection,
        reset ? -currentLng : appliedDeltaLng,
        reset ? -currentLat : appliedDeltaLat,
        saved.deltaLng,
        saved.deltaLat,
      )
      setCadastralSelection((current) => current ? {
        ...current,
        center: current.center ? [
          current.center[0] + (reset ? -currentLng : appliedDeltaLng),
          current.center[1] + (reset ? -currentLat : appliedDeltaLat),
        ] : undefined,
        properties: { ...current.properties, correction_lng: saved.deltaLng, correction_lat: saved.deltaLat },
      } : null)
      setAdjustmentMode(false)
      setAdjustmentDelta({ lng: 0, lat: 0 })
      setAdjustmentNotice(saved.limited ? saved.limitReason : (reset ? "Se restauró la posición oficial." : "Posición guardada correctamente."))
      reloadLastView()
    } catch (error) {
      if (!reportError(error)) setMapError(friendlyError(error))
    } finally {
      setAdjustmentSaving(false)
    }
  }, [adjustmentDelta, applyCorrection, cadastralSelection, isReadOnly, reloadLastView, reportError, setMapError])

  const clearSelection = useCallback((): void => {
    setSelectionFocusBehavior("auto")
    setAdjustmentDelta({ lng: 0, lat: 0 })
    setAdjustmentNotice(null)
    resetSelection()
  }, [resetSelection])

  const mapViewProps = useMemo(() => ({
    adjustmentDelta,
    adjustmentMode,
    focusedPlace,
    focusedPlaceFocusToken: placeFocusToken,
    focusedSupply: selectedSupply,
    focusedSupplyGroup,
    focusedSupplyFocusToken: supplyFocusToken,
    buildingDigitizationMode,
    buildingFootprint: activeBuildingFootprint,
    buildingFootprintDraft,
    onBuildingFootprintPoint: addBuildingFootprintPoint,
    lotSplitMode,
    lotSplitDraftLine,
    lotSplitSuggestion,
    onLotSplitPoint: addLotSplitPoint,
    onAdjustmentDeltaChange: setAdjustmentDelta,
    onCadastralSelect: selectMapCadastral,
    onLocationSelect: selectMapLocation,
    onSupplySelect: selectSupply,
    selectedCadastral: cadastralSelection,
    selectionFocusBehavior,
  }), [
    adjustmentDelta, adjustmentMode, focusedPlace, placeFocusToken, selectedSupply, focusedSupplyGroup,
    supplyFocusToken, buildingDigitizationMode, activeBuildingFootprint, buildingFootprintDraft, addBuildingFootprintPoint,
    lotSplitMode, lotSplitDraftLine, lotSplitSuggestion, addLotSplitPoint,
    selectMapCadastral, selectMapLocation, selectSupply, cadastralSelection, selectionFocusBehavior,
  ])

  const value = useMemo(() => ({
    selectedSupply,
    resolvedLocation,
    resolvedLocationPoint,
    cadastralSelection,
    inspectorLoading,
    adjustmentMode,
    adjustmentDelta,
    adjustmentSaving,
    adjustmentNotice,
    buildingFootprint: activeBuildingFootprint,
    buildingFootprintDraft,
    buildingDigitizationMode,
    buildingFootprintSaving,
    buildingFootprintNotice,
    lotSplitMode,
    lotSplitDraftLine,
    lotSplitSuggestion,
    lotSplitLoadingSuggestion,
    lotSplitSaving,
    lotSplitNotice,
    activeLotSplitParentId,
    mapViewProps,
    selectSupply,
    searchSupply,
    searchCadastre,
    selectCadastreResult,
    searchPlaces,
    selectPlace,
    viewSupplyCadastre,
    startAdjustment,
    nudgeAdjustment,
    cancelAdjustment,
    persistAdjustment,
    startBuildingDigitization,
    addBuildingFootprintPoint,
    cancelBuildingDigitization,
    persistBuildingFootprint,
    startLotSplit,
    cancelLotSplit,
    persistLotSplit,
    undoLotSplit,
    clearSelection,
  }), [
    selectedSupply, resolvedLocation, resolvedLocationPoint, cadastralSelection, inspectorLoading, adjustmentMode,
    adjustmentDelta, adjustmentSaving, adjustmentNotice, activeBuildingFootprint, buildingFootprintDraft,
    buildingDigitizationMode, buildingFootprintSaving, buildingFootprintNotice,
    lotSplitMode, lotSplitDraftLine, lotSplitSuggestion, lotSplitLoadingSuggestion, lotSplitSaving, lotSplitNotice,
    activeLotSplitParentId, mapViewProps, selectSupply, searchSupply,
    searchCadastre, selectCadastreResult, searchPlaces, selectPlace, viewSupplyCadastre, startAdjustment,
    nudgeAdjustment, cancelAdjustment, persistAdjustment, startBuildingDigitization, addBuildingFootprintPoint,
    cancelBuildingDigitization, persistBuildingFootprint, startLotSplit, cancelLotSplit, persistLotSplit, undoLotSplit,
    clearSelection,
  ])

  return <SelectionContext value={value}>{children}</SelectionContext>
}
