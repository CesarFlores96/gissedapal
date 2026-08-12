import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { FeatureCollection, Geometry } from "geojson"

import { getLotContext } from "../features/map/lotContext"
import type { CadastralSelection, DistrictOption, GisLayersResponse, LayerKey, SupplyDetail } from "../types"
import { Button } from "./ui/Button"

const sourceIds: Record<LayerKey, string> = {
  distritos: "districts-source",
  manzanas: "blocks-source",
  cuadrantes: "quadrants-source",
  lotes: "local-lots",
  tuberias: "water-pipes-source",
  alcantarillado: "sewer-source",
  suministros: "supplies-source",
  medidores: "meters-source",
}

const layerGroups: Record<LayerKey, string[]> = {
  distritos: ["district-mask", "district-fill", "district-line"],
  manzanas: ["block-fill", "block-line", "block-label", "selected-block-fill", "selected-block-line"],
  cuadrantes: ["quadrant-fill", "quadrant-line"],
  lotes: ["lot-fill", "lot-line", "lot-label", "selected-lot-fill", "selected-lot-line"],
  tuberias: ["water-pipes-line"],
  alcantarillado: ["sewer-line"],
  suministros: ["supply-points"],
  medidores: ["meter-points"],
}

const emptyCollection: FeatureCollection<Geometry> = { type: "FeatureCollection", features: [] }
const districtPalette = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#6366f1", "#14b8a6", "#e879f9"]
const fallbackDistrictColor = "#64748b"

/** Duración del atenuado al filtrar por distrito. */
const FADE_MS = 420

function colorForDistrict(name: string): string {
  let hash = 0
  for (const character of name) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return districtPalette[Math.abs(hash) % districtPalette.length]
}

/**
 * Expresión `match` que colorea por distrito dentro del motor de estilos.
 *
 * Antes esto se resolvía clonando cada feature para inyectarle `district_color`,
 * lo que suponía recorrer y duplicar la colección entera en cada respuesta.
 */
function districtColorExpression(
  property: "name" | "district",
  districts: DistrictOption[],
): maplibregl.ExpressionSpecification | string {
  if (!districts.length) return fallbackDistrictColor
  const pairs = districts.flatMap((district) => [district.name, colorForDistrict(district.name)])
  return ["match", ["get", property], ...pairs, fallbackDistrictColor] as unknown as maplibregl.ExpressionSpecification
}

function extendBounds(bounds: maplibregl.LngLatBounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    bounds.extend([coordinates[0], coordinates[1]])
    return
  }
  for (const child of coordinates) extendBounds(bounds, child)
}

function featureMatchesSelection(
  feature: FeatureCollection<Geometry, Record<string, unknown>>["features"][number],
  selection: CadastralSelection,
): boolean {
  const recordId = typeof feature.properties?.record_id === "string" ? feature.properties.record_id : String(feature.id ?? "")
  if (recordId && recordId === String(selection.id)) return true
  if (selection.kind === "lot") return feature.properties?.lot_code === selection.properties.lot_code
  return feature.properties?.block_code === selection.properties.block_code
}

type MapViewProps = {
  activeLayers: Set<LayerKey>
  adjustmentDelta: { lng: number; lat: number }
  adjustmentMode: boolean
  data: GisLayersResponse | null
  districts: DistrictOption[]
  focusedSupplyFocusToken: number
  focusedSupply: SupplyDetail | null
  onBoundsChange: (bbox: [number, number, number, number], zoom: number) => void
  onCadastralSelect: (selection: CadastralSelection) => void
  onAdjustmentDeltaChange: (delta: { lng: number; lat: number }) => void
  onLocationSelect: (lng: number, lat: number) => void
  onError: (message: string) => void
  onSupplySelect: (supplyCode: string) => void
  selectionFocusBehavior: "auto" | "preserve"
  selectedCadastral: CadastralSelection | null
  selectedDistrict: DistrictOption | null
  threeDimensional: boolean
}

function translateCoordinates(coordinates: unknown, lng: number, lat: number): unknown {
  if (!Array.isArray(coordinates)) return coordinates
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0] + lng, coordinates[1] + lat, ...coordinates.slice(2)]
  }
  return coordinates.map((child) => translateCoordinates(child, lng, lat))
}

function previewCollection(
  collection: FeatureCollection<Geometry, Record<string, unknown>>,
  key: LayerKey,
  selected: CadastralSelection | null,
  delta: { lng: number; lat: number },
): FeatureCollection<Geometry, Record<string, unknown>> {
  if (!selected || (!delta.lng && !delta.lat)) return collection
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const recordId = typeof feature.properties?.record_id === "string" ? feature.properties.record_id : String(feature.id ?? "")
      const selectedBlock = selected.kind === "block" && key === "manzanas" && recordId === selected.id
      const selectedLot = selected.kind === "lot" && key === "lotes" && recordId === selected.id
      const childLot = selected.kind === "block" && key === "lotes" && feature.properties?.block_code === selected.properties.block_code
      if ((!selectedBlock && !selectedLot && !childLot) || !("coordinates" in feature.geometry)) return feature
      return {
        ...feature,
        geometry: { ...feature.geometry, coordinates: translateCoordinates(feature.geometry.coordinates, delta.lng, delta.lat) } as Geometry,
      }
    }),
  }
}

function featureRecordId(feature: maplibregl.MapGeoJSONFeature, kind: "block" | "lot"): string {
  const properties = feature.properties ?? {}
  const recordId = properties.record_id
  if (typeof recordId === "string" && recordId) return recordId
  const sourceId = properties.id
  if (typeof sourceId === "string" && sourceId) return sourceId
  const fallback = kind === "lot" ? properties.lot_code : properties.block_code
  return String(feature.id ?? fallback ?? "")
}

function selectionCenter(selection: CadastralSelection | null): [number, number] | null {
  if (!selection) return null
  const [rawLng, rawLat] = Array.isArray(selection.center) ? selection.center : [null, null]
  const lng = typeof rawLng === "number" ? rawLng : Number(rawLng)
  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat)
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat]

  const propertyLng = Number(
    selection.properties.center_lng
    ?? selection.properties.lng
    ?? selection.properties.longitude
    ?? selection.properties.lon,
  )
  const propertyLat = Number(
    selection.properties.center_lat
    ?? selection.properties.lat
    ?? selection.properties.latitude,
  )
  return Number.isFinite(propertyLng) && Number.isFinite(propertyLat)
    ? [propertyLng, propertyLat]
    : null
}

/**
 * Fuentes y capas del visor.
 *
 * Las opciones `tolerance`/`buffer`/`maxzoom` de las fuentes GeoJSON reducen el
 * teselado que MapLibre hace en el hilo principal, que era una de las causas del
 * tirón al panear con catastro activo.
 */
function addSourcesAndLayers(map: MapLibreMap): void {
  const vectorSource = { type: "geojson" as const, buffer: 64, tolerance: 0.5, maxzoom: 16 }

  map.addSource(sourceIds.distritos, { ...vectorSource, data: emptyCollection, maxzoom: 12 })
  map.addLayer({
    id: "district-mask",
    type: "fill",
    source: sourceIds.distritos,
    paint: { "fill-color": "#04040a", "fill-opacity": 0, "fill-opacity-transition": { duration: FADE_MS, delay: 0 } },
  })
  map.addLayer({
    id: "district-fill",
    type: "fill",
    source: sourceIds.distritos,
    paint: {
      "fill-color": fallbackDistrictColor,
      "fill-opacity": 0.08,
      "fill-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "district-extrusion",
    type: "fill-extrusion",
    source: sourceIds.distritos,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": fallbackDistrictColor,
      "fill-extrusion-height": ["interpolate", ["linear"], ["coalesce", ["get", "supply_count"], 0], 0, 0, 250, 350, 1000, 1200, 4000, 3200],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.68,
    },
  })
  map.addLayer({
    id: "district-line",
    type: "line",
    source: sourceIds.distritos,
    paint: {
      "line-color": "#94a3b8",
      "line-width": 1.2,
      "line-opacity": 0.75,
      "line-width-transition": { duration: FADE_MS, delay: 0 },
      "line-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })

  // --- Manzanas -------------------------------------------------------------
  // Sin relleno sólido: sobre un basemap ráster, dos rellenos apilados (manzana
  // y lote) emborronan las calles. La manzana se lee por su contorno y conserva
  // un relleno casi transparente sólo para poder recibir clics.
  map.addSource(sourceIds.manzanas, { ...vectorSource, data: emptyCollection, promoteId: "record_id" })
  map.addLayer({
    id: "block-fill",
    type: "fill",
    source: sourceIds.manzanas,
    minzoom: 13,
    paint: {
      "fill-color": "#2563eb",
      "fill-opacity": 0.03,
      "fill-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "block-line",
    type: "line",
    source: sourceIds.manzanas,
    minzoom: 13,
    paint: {
      "line-color": "#1d4ed8",
      "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 17, 1.6],
      "line-opacity": 0.55,
      "line-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "block-label",
    type: "symbol",
    source: sourceIds.manzanas,
    minzoom: 14.5,
    layout: {
      "text-field": ["concat", "MZ ", ["get", "block_code"]],
      "text-size": 11,
      "text-allow-overlap": false,
      "text-padding": 6,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "area_m2"], 0]],
    },
    paint: { "text-color": "#1e3a8a", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  })
  map.addLayer({
    id: "selected-block-fill",
    type: "fill",
    source: sourceIds.manzanas,
    minzoom: 13,
    filter: ["==", ["get", "block_code"], ""],
    paint: { "fill-color": "#22d3ee", "fill-opacity": 0.18 },
  })
  map.addLayer({
    id: "selected-block-line",
    type: "line",
    source: sourceIds.manzanas,
    minzoom: 13,
    filter: ["==", ["get", "block_code"], ""],
    paint: { "line-color": "#06b6d4", "line-width": 3.5 },
  })

  map.addSource(sourceIds.cuadrantes, { ...vectorSource, data: emptyCollection })
  map.addLayer({ id: "quadrant-fill", type: "fill", source: sourceIds.cuadrantes, paint: { "fill-color": "#8b5cf6", "fill-opacity": 0.1 } })
  map.addLayer({ id: "quadrant-line", type: "line", source: sourceIds.cuadrantes, paint: { "line-color": "#7c3aed", "line-width": 1.4, "line-opacity": 0.7 } })

  // --- Lotes ----------------------------------------------------------------
  // El relleno baja de 0.32 a 0.14 y el contorno deja de ser blanco opaco: esa
  // combinación era la que tapaba pistas y avenidas del basemap.
  map.addSource(sourceIds.lotes, { ...vectorSource, data: emptyCollection, promoteId: "record_id" })
  map.addLayer({
    id: "lot-fill",
    type: "fill",
    source: sourceIds.lotes,
    minzoom: 15,
    paint: {
      "fill-color": ["match", ["get", "lot_type_code"], "TL003", "#4d9b62", "TL005", "#65a96f", "TL002", "#94a3b8", "TL001", "#b8b8b8", "#d6a756"],
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.2, 17, 0.16, 19, 0.14],
      "fill-antialias": true,
      // El contorno del fill replica bordes clippeados por tile y hace que
      // los lotes se perciban "cortados". Dejamos un unico line-layer suave.
      "fill-outline-color": "rgba(0, 0, 0, 0)",
      "fill-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "lot-line",
    type: "line",
    source: sourceIds.lotes,
    minzoom: 15,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#475569",
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.35, 17, 0.7, 19, 1.05],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.34, 17, 0.42, 19, 0.5],
      "line-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "lot-label",
    type: "symbol",
    source: sourceIds.lotes,
    minzoom: 16.4,
    layout: {
      "text-field": ["get", "display_code"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 2,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "area_m2"], 0]],
    },
    paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.3 },
  })
  map.addLayer({
    id: "selected-lot-fill",
    type: "fill",
    source: sourceIds.lotes,
    minzoom: 15,
    filter: ["==", ["get", "lot_code"], ""],
    paint: { "fill-color": "#fdba74", "fill-opacity": 0.34 },
  })
  map.addLayer({
    id: "selected-lot-line",
    type: "line",
    source: sourceIds.lotes,
    minzoom: 15,
    filter: ["==", ["get", "lot_code"], ""],
    paint: { "line-color": "#f97316", "line-width": 3.5 },
  })
  map.addLayer({
    id: "lot-building-extrusion",
    type: "fill-extrusion",
    source: sourceIds.lotes,
    minzoom: 15,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": ["match", ["get", "lot_type_code"], "TL003", "#4d9b62", "TL005", "#65a96f", "TL001", "#a3a3a3", "#c6903f"],
      "fill-extrusion-height": ["interpolate", ["linear"], ["coalesce", ["get", "levels"], 0], 0, 1.2, 1, 3, 5, 15, 20, 60],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.72,
    },
  })

  map.addSource(sourceIds.tuberias, { ...vectorSource, data: emptyCollection })
  map.addLayer({ id: "water-pipes-line", type: "line", source: sourceIds.tuberias, paint: { "line-color": "#0284c7", "line-width": 2.5, "line-opacity-transition": { duration: FADE_MS, delay: 0 } } })

  map.addSource(sourceIds.alcantarillado, { ...vectorSource, data: emptyCollection, lineMetrics: true })
  map.addLayer({ id: "sewer-line", type: "line", source: sourceIds.alcantarillado, paint: { "line-color": "#b45309", "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity-transition": { duration: FADE_MS, delay: 0 } } })

  // Cada suministro se representa como un punto desde el primer nivel de zoom.
  // No se usa cluster: ocultaba los NIS bajo un contador y obligaba a acercarse.
  map.addSource(sourceIds.suministros, { type: "geojson", data: emptyCollection, cluster: false })
  map.addLayer({ id: "supply-points", type: "circle", source: sourceIds.suministros, paint: { "circle-color": "#06b6d4", "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 17, 9], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.35, "circle-opacity-transition": { duration: FADE_MS, delay: 0 } } })

  map.addSource("focused-supply-source", { type: "geojson", data: emptyCollection })
  map.addLayer({ id: "focused-supply-halo", type: "circle", source: "focused-supply-source", paint: { "circle-color": "#f97316", "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 19, 17, 29], "circle-opacity": 0.22, "circle-stroke-color": "#fff7ed", "circle-stroke-width": 3 } })
  map.addLayer({ id: "focused-supply-point", type: "circle", source: "focused-supply-source", paint: { "circle-color": "#f97316", "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 17, 12], "circle-stroke-color": "#7c2d12", "circle-stroke-width": 2.5 } })

  map.addSource(sourceIds.medidores, { type: "geojson", data: emptyCollection, cluster: false })
  map.addLayer({ id: "meter-points", type: "circle", source: sourceIds.medidores, minzoom: 14, paint: { "circle-color": "#22c55e", "circle-radius": 3, "circle-stroke-color": "#14532d", "circle-stroke-width": 1, "circle-opacity-transition": { duration: FADE_MS, delay: 0 } } })
}

function MapViewComponent({
  activeLayers,
  adjustmentDelta,
  adjustmentMode,
  data,
  districts,
  focusedSupply,
  focusedSupplyFocusToken,
  onAdjustmentDeltaChange,
  onBoundsChange,
  onCadastralSelect,
  onLocationSelect,
  onError,
  onSupplySelect,
  selectionFocusBehavior,
  selectedCadastral,
  selectedDistrict,
  threeDimensional,
}: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readoutRef = useRef<HTMLOutputElement | null>(null)
  const boundsCallbackRef = useRef(onBoundsChange)
  const selectCallbackRef = useRef(onSupplySelect)
  const cadastralCallbackRef = useRef(onCadastralSelect)
  const locationCallbackRef = useRef(onLocationSelect)
  const errorCallbackRef = useRef(onError)
  const activeLayersRef = useRef(activeLayers)
  const threeDimensionalRef = useRef(threeDimensional)
  const adjustmentModeRef = useRef(adjustmentMode)
  const adjustmentDeltaRef = useRef(adjustmentDelta)
  const adjustmentCallbackRef = useRef(onAdjustmentDeltaChange)
  const selectedCadastralRef = useRef(selectedCadastral)
  const renderedSourceDataRef = useRef<Partial<Record<LayerKey, FeatureCollection<Geometry>>>>({})
  const lastFocusKeyRef = useRef<string | null>(null)
  const appliedCadastreFocusRef = useRef<string | null>(null)
  const appliedDistrictFocusRef = useRef<string | null>(null)
  const dragStateRef = useRef<{ lng: number; lat: number; delta: { lng: number; lat: number } } | null>(null)
  const [basemap, setBasemap] = useState<"streets" | "satellite">("streets")
  const [styleReady, setStyleReady] = useState(false)

  useEffect(() => { boundsCallbackRef.current = onBoundsChange }, [onBoundsChange])
  useEffect(() => { selectCallbackRef.current = onSupplySelect }, [onSupplySelect])
  useEffect(() => { cadastralCallbackRef.current = onCadastralSelect }, [onCadastralSelect])
  useEffect(() => { locationCallbackRef.current = onLocationSelect }, [onLocationSelect])
  useEffect(() => { errorCallbackRef.current = onError }, [onError])
  useEffect(() => { activeLayersRef.current = activeLayers }, [activeLayers])
  useEffect(() => { threeDimensionalRef.current = threeDimensional }, [threeDimensional])
  useEffect(() => { adjustmentModeRef.current = adjustmentMode }, [adjustmentMode])
  useEffect(() => { adjustmentDeltaRef.current = adjustmentDelta }, [adjustmentDelta])
  useEffect(() => { adjustmentCallbackRef.current = onAdjustmentDeltaChange }, [onAdjustmentDeltaChange])
  useEffect(() => { selectedCadastralRef.current = selectedCadastral }, [selectedCadastral])
  useEffect(() => {
    if (!selectedCadastral) appliedCadastreFocusRef.current = null
  }, [selectedCadastral])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let disposed = false
    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: false,
      center: [-77.042793, -12.046374],
      zoom: 10.4,
      canvasContextAttributes: { antialias: true },
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" },
          satellite: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: "Esri, Maxar, Earthstar Geographics" },
        },
        layers: [
          { id: "map-background", type: "background", paint: { "background-color": "#dbe4e8" } },
          { id: "osm", type: "raster", source: "osm" },
          { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
        ],
      },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    const publishBounds = (): void => {
      const bounds = map.getBounds()
      boundsCallbackRef.current([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getZoom())
    }

    map.on("load", () => {
      if (disposed) return
      addSourcesAndLayers(map)
      for (const key of Object.keys(layerGroups) as LayerKey[]) {
        const visibility = activeLayersRef.current.has(key) ? "visible" : "none"
        for (const layerId of layerGroups[key]) map.setLayoutProperty(layerId, "visibility", visibility)
      }
      publishBounds()
      setStyleReady(true)
    })
    map.on("moveend", publishBounds)

    // La lectura de coordenadas se escribe directamente en el DOM y coalescida
    // por frame. Con `useState` esto disparaba un render de React por cada evento
    // de ratón, es decir ~60 por segundo mientras el cursor está sobre el mapa.
    let readoutFrame: number | null = null
    let pendingLngLat: maplibregl.LngLat | null = null
    const flushReadout = (): void => {
      readoutFrame = null
      const node = readoutRef.current
      if (!node) return
      node.textContent = pendingLngLat
        ? `Lng ${pendingLngLat.lng.toFixed(6)} · Lat ${pendingLngLat.lat.toFixed(6)}`
        : "Mueve el cursor para ver longitud y latitud"
    }
    const queueReadout = (lngLat: maplibregl.LngLat | null): void => {
      pendingLngLat = lngLat
      if (readoutFrame === null) readoutFrame = requestAnimationFrame(flushReadout)
    }

    map.on("mousemove", (event) => queueReadout(event.lngLat))
    map.on("mouseout", () => queueReadout(null))

    const pointHitLayers = ["supply-points", "meter-points"]
    const pointHitRadiusPx = 8

    // Los círculos de suministro/medidor son pequeños (6-11px de radio), así que un click
    // exacto por pixel deja un margen de error real: un click a unos pixeles del centro caía
    // fuera del círculo y, como el lote/manzana debajo sí cubre esa área, la app abría la
    // ficha del predio en vez de la del suministro. Se resuelve con una caja de tolerancia
    // alrededor del click y quedándonos con el punto renderizado más cercano.
    const queryNearestPointFeature = (point: maplibregl.Point): maplibregl.MapGeoJSONFeature | null => {
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - pointHitRadiusPx, point.y - pointHitRadiusPx],
        [point.x + pointHitRadiusPx, point.y + pointHitRadiusPx],
      ]
      const features = map.queryRenderedFeatures(box, { layers: pointHitLayers })
      if (!features.length) return null
      let nearest = features[0]
      let nearestDist = Infinity
      for (const feature of features) {
        if (feature.geometry.type !== "Point") continue
        const projected = map.project(feature.geometry.coordinates as [number, number])
        const dist = Math.hypot(projected.x - point.x, projected.y - point.y)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = feature
        }
      }
      return nearest
    }

    // Un solo handler de click resuelve la precedencia explícitamente (punto > lote > manzana
    // > ubicación vacía) en vez de depender del orden de despacho de MapLibre: la API dispara
    // TODOS los handlers 'click' por capa cuyas features caigan bajo el punto, no solo el de
    // la capa visualmente superior, y event.preventDefault() no cambia eso (solo suprime
    // comportamientos internos como drag/box-zoom).
    map.on("click", (event) => {
      if (adjustmentModeRef.current) return

      const pointFeature = queryNearestPointFeature(event.point)
      if (pointFeature) {
        const supplyCode = pointFeature.properties?.supply_code
        if (typeof supplyCode === "string") selectCallbackRef.current(supplyCode)
        return
      }

      const lotFeature = map.queryRenderedFeatures(event.point, { layers: ["lot-fill"] })[0]
      if (lotFeature?.properties) {
        const lotId = featureRecordId(lotFeature, "lot")
        const selection: CadastralSelection = {
          id: lotId,
          kind: "lot",
          properties: lotFeature.properties,
          center: [event.lngLat.lng, event.lngLat.lat],
        }
        selectedCadastralRef.current = selection
        cadastralCallbackRef.current(selection)
        void getLotContext(lotId)
          .then((context) => {
            if (selectedCadastralRef.current?.id !== lotId) return
            cadastralCallbackRef.current({
              ...selection,
              properties: { ...selection.properties, lotContext: context },
            })
          })
          .catch(() => errorCallbackRef.current("No se pudo consultar el contexto del lote."))
        return
      }

      const blockFeature = map.queryRenderedFeatures(event.point, { layers: ["block-fill"] })[0]
      if (blockFeature?.properties) {
        cadastralCallbackRef.current({
          id: featureRecordId(blockFeature, "block"),
          kind: "block",
          properties: blockFeature.properties,
          center: [event.lngLat.lng, event.lngLat.lat],
        })
        return
      }

      locationCallbackRef.current(event.lngLat.lng, event.lngLat.lat)
    })
    for (const layerId of ["supply-points", "meter-points", "lot-fill", "block-fill"]) {
      map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer" })
      map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = "" })
    }

    const finishSelectedDrag = (): void => {
      if (!dragStateRef.current) return
      dragStateRef.current = null
      map.dragPan.enable()
      map.getCanvas().style.cursor = adjustmentModeRef.current ? "grab" : ""
    }

    const startSelectedDrag = (kind: "block" | "lot", event: maplibregl.MapLayerMouseEvent): void => {
      const selected = selectedCadastralRef.current
      if (!adjustmentModeRef.current || !selected || selected.kind !== kind) return
      const feature = event.features?.find((candidate) => featureRecordId(candidate, kind) === selected.id)
      if (!feature) return
      event.preventDefault()
      event.originalEvent.stopPropagation()
      dragStateRef.current = { lng: event.lngLat.lng, lat: event.lngLat.lat, delta: adjustmentDeltaRef.current }
      map.dragPan.disable()
      map.getCanvas().style.cursor = "grabbing"
    }

    map.on("mousedown", "lot-fill", (event) => startSelectedDrag("lot", event))
    map.on("mousedown", "block-fill", (event) => startSelectedDrag("block", event))
    map.on("mousemove", (event) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      adjustmentCallbackRef.current({
        lng: dragState.delta.lng + event.lngLat.lng - dragState.lng,
        lat: dragState.delta.lat + event.lngLat.lat - dragState.lat,
      })
    })
    map.on("mouseup", finishSelectedDrag)
    map.on("mouseleave", finishSelectedDrag)
    window.addEventListener("mouseup", finishSelectedDrag)

    return () => {
      disposed = true
      if (readoutFrame !== null) cancelAnimationFrame(readoutFrame)
      window.removeEventListener("mouseup", finishSelectedDrag)
      map.remove()
      mapRef.current = null
      setStyleReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.setLayoutProperty("osm", "visibility", basemap === "streets" ? "visible" : "none")
    map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none")
  }, [basemap, styleReady])

  // Color por distrito resuelto con una expresión en vez de clonando features.
  const districtFillColor = useMemo(() => districtColorExpression("name", districts), [districts])
  const supplyCircleColor = useMemo(() => districtColorExpression("district", districts), [districts])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.setPaintProperty("district-fill", "fill-color", districtFillColor)
    map.setPaintProperty("district-extrusion", "fill-extrusion-color", districtFillColor)
    map.setPaintProperty("supply-points", "circle-color", supplyCircleColor)
  }, [districtFillColor, styleReady, supplyCircleColor])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const source = map.getSource("focused-supply-source") as GeoJSONSource | undefined
    const geometry = focusedSupply?.geometry
    const point = geometry?.type === "Point" ? geometry.coordinates : null
    if (!source || !point || typeof point[0] !== "number" || typeof point[1] !== "number") {
      source?.setData(emptyCollection)
      return
    }
    source.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: {} }] })
  }, [focusedSupply, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !data) return
    for (const [key, payload] of Object.entries(data.layers)) {
      if (!payload) continue
      const layerKey = key as LayerKey
      // La respuesta de una capa no debe retesselar todas las demás fuentes.
      // Esto también evita redibujar distritos y suministros al completar lotes.
      const nextData = adjustmentMode
        ? previewCollection(payload.data, layerKey, selectedCadastral, adjustmentDelta)
        : payload.data
      if (renderedSourceDataRef.current[layerKey] === nextData) continue
      const source = map.getSource(sourceIds[layerKey]) as GeoJSONSource | undefined
      source?.setData(nextData)
      renderedSourceDataRef.current[layerKey] = nextData
    }
  }, [adjustmentDelta, adjustmentMode, data, selectedCadastral, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const editingBlock = adjustmentMode && selectedCadastral?.kind === "block"
    const editingLot = adjustmentMode && selectedCadastral?.kind === "lot"
    map.setPaintProperty("selected-block-fill", "fill-opacity", editingBlock ? 0.26 : 0.18)
    map.setPaintProperty("selected-block-line", "line-width", editingBlock ? 5.5 : 3.5)
    map.setPaintProperty("selected-block-line", "line-color", editingBlock ? "#0891b2" : "#06b6d4")
    map.setPaintProperty("selected-lot-fill", "fill-opacity", editingLot ? 0.42 : 0.34)
    map.setPaintProperty("selected-lot-line", "line-width", editingLot ? 5.5 : 3.5)
    map.setPaintProperty("selected-lot-line", "line-color", editingLot ? "#ea580c" : "#f97316")
    map.getCanvas().style.cursor = adjustmentMode ? "grab" : ""
  }, [adjustmentMode, selectedCadastral, styleReady])

  // Atenuado del resto del mapa al filtrar por distrito. Las transiciones se
  // declaran en las capas, así que estos cambios se interpolan en vez de saltar.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const name = selectedDistrict?.name ?? null
    const isSelected = (property: string): maplibregl.ExpressionSpecification =>
      ["==", ["get", property], name] as unknown as maplibregl.ExpressionSpecification

    map.setPaintProperty("district-fill", "fill-opacity", name ? ["case", isSelected("name"), 0.22, 0.02] : 0.08)
    map.setPaintProperty("district-mask", "fill-opacity", name ? ["case", isSelected("name"), 0, 0.55] : 0)
    map.setPaintProperty("district-line", "line-width", name ? ["case", isSelected("name"), 2.6, 0.6] : 1.2)
    map.setPaintProperty("district-line", "line-opacity", name ? ["case", isSelected("name"), 0.95, 0.3] : 0.75)

    for (const layerId of ["supply-points", "meter-points"]) {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, "circle-opacity", name ? ["case", isSelected("district"), 0.95, 0.15] : 1)
      }
    }
    map.setPaintProperty("block-fill", "fill-opacity", name ? ["case", isSelected("district"), 0.03, 0.008] : 0.03)
    map.setPaintProperty("block-line", "line-opacity", name ? ["case", isSelected("district"), 0.55, 0.12] : 0.55)
    map.setPaintProperty(
      "lot-fill",
      "fill-opacity",
      name
        ? ["case", isSelected("district"), ["interpolate", ["linear"], ["zoom"], 15, 0.22, 17, 0.18, 19, 0.16], 0.03]
        : ["interpolate", ["linear"], ["zoom"], 15, 0.2, 17, 0.16, 19, 0.14],
    )
    map.setPaintProperty(
      "lot-line",
      "line-opacity",
      name
        ? ["case", isSelected("district"), ["interpolate", ["linear"], ["zoom"], 15, 0.36, 17, 0.42, 19, 0.5], 0.08]
        : ["interpolate", ["linear"], ["zoom"], 15, 0.34, 17, 0.42, 19, 0.5],
    )
    for (const layerId of ["water-pipes-line", "sewer-line", "quadrant-line"]) {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, "line-opacity", name ? 0.16 : 1)
    }
  }, [selectedDistrict, styleReady])

  // Encuadre del distrito. Usa la envolvente que ya viene en el catálogo, así que
  // no depende de que la capa de geometría haya terminado de cargar.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (!selectedDistrict?.bounds) {
      appliedDistrictFocusRef.current = null
      return
    }
    if (selectedCadastral || focusedSupply) return
    const focusKey = `district:${selectedDistrict.name}`
    if (appliedDistrictFocusRef.current === focusKey) return
    appliedDistrictFocusRef.current = focusKey
    lastFocusKeyRef.current = focusKey

    const [minLng, minLat, maxLng, maxLat] = selectedDistrict.bounds
    map.stop()
    const padding = { top: 80, right: 400, bottom: 80, left: 80 }
    const camera = map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], { padding, maxZoom: 14.5 })
    if (!camera) return
    map.flyTo({ ...camera, duration: 1200, essential: true })
  }, [focusedSupply, selectedCadastral, selectedDistrict, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const showExtrusion = threeDimensional && activeLayers.has("distritos") && !selectedDistrict
    map.setLayoutProperty("district-extrusion", "visibility", showExtrusion ? "visible" : "none")
    map.setLayoutProperty("lot-building-extrusion", "visibility", threeDimensional && activeLayers.has("lotes") ? "visible" : "none")
  }, [activeLayers, selectedDistrict, styleReady, threeDimensional])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.easeTo({ pitch: threeDimensional ? 55 : 0, bearing: threeDimensional ? -18 : 0, duration: 650 })
  }, [styleReady, threeDimensional])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (!selectedCadastral && lastFocusKeyRef.current?.startsWith("cadastre:")) {
      lastFocusKeyRef.current = null
    }
    const lotCode = selectedCadastral?.kind === "lot" ? selectedCadastral.properties.lot_code : null
    const blockCode = selectedCadastral?.kind === "block" ? selectedCadastral.properties.block_code : null
    map.setFilter("selected-lot-fill", ["==", ["get", "lot_code"], typeof lotCode === "string" ? lotCode : ""])
    map.setFilter("selected-lot-line", ["==", ["get", "lot_code"], typeof lotCode === "string" ? lotCode : ""])
    map.setFilter("selected-block-fill", ["==", ["get", "block_code"], typeof blockCode === "string" ? blockCode : ""])
    map.setFilter("selected-block-line", ["==", ["get", "block_code"], typeof blockCode === "string" ? blockCode : ""])
  }, [selectedCadastral, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (selectionFocusBehavior === "preserve") return
    const center = selectionCenter(selectedCadastral)
    if (center && selectedCadastral) {
      const focusKey = `cadastre:center:${selectedCadastral.kind}:${selectedCadastral.id}`
      if (appliedCadastreFocusRef.current === focusKey) return
      appliedCadastreFocusRef.current = focusKey
      lastFocusKeyRef.current = focusKey
      map.stop()
      const minimumZoom = selectedCadastral.kind === "lot" ? 18 : 15
      const targetZoom = Math.max(map.getZoom(), minimumZoom)
      map.easeTo({ center, zoom: targetZoom, pitch: threeDimensional ? 45 : 0, duration: 650, essential: true })
    }
  }, [selectedCadastral, selectionFocusBehavior, threeDimensional])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedCadastral) return
    if (selectionFocusBehavior === "preserve") return
    const focusKey = `cadastre:geometry:${selectedCadastral.kind}:${selectedCadastral.id}`
    if (appliedCadastreFocusRef.current === focusKey) return
    const layerKey: LayerKey = selectedCadastral.kind === "lot" ? "lotes" : "manzanas"
    const features = data?.layers[layerKey]?.data.features ?? []
    const match = features.find((feature) => featureMatchesSelection(feature, selectedCadastral))
    if (!match || !("coordinates" in match.geometry)) return
    const bounds = new maplibregl.LngLatBounds()
    extendBounds(bounds, match.geometry.coordinates)
    if (!bounds.isEmpty()) {
      appliedCadastreFocusRef.current = focusKey
      lastFocusKeyRef.current = focusKey
      map.stop()
      map.fitBounds(bounds, {
        padding: { top: 90, right: 420, bottom: 90, left: 90 },
        maxZoom: selectedCadastral.kind === "lot" ? 19 : 17,
        duration: 950,
      })
    }
  }, [data, selectedCadastral, selectionFocusBehavior])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (focusedSupply?.geometry?.type !== "Point") return
    const focusKey = `supply:${focusedSupply.supply.code}:${focusedSupplyFocusToken}`
    if (lastFocusKeyRef.current === focusKey) return
    const [lng, lat] = focusedSupply.geometry.coordinates
    if (typeof lng !== "number" || typeof lat !== "number") return
    lastFocusKeyRef.current = focusKey
    map.stop()
    const targetZoom = Math.max(map.getZoom(), 17)
    // easeTo interpola centro/zoom/pitch directamente. flyTo, en cambio, sigue
    // una curva que aleja la cámara a propósito para dar contexto en saltos
    // largos (su "swoop" por defecto) — visible cada vez que el suministro
    // elegido está lejos del encuadre actual, aunque el destino sea fijo (z17).
    map.easeTo({
      center: [lng, lat],
      zoom: targetZoom,
      pitch: threeDimensional ? 55 : 25,
      duration: 1200,
      essential: true,
    })
  }, [focusedSupply, focusedSupplyFocusToken, styleReady, threeDimensional])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    for (const key of Object.keys(layerGroups) as LayerKey[]) {
      const visibility = activeLayers.has(key) ? "visible" : "none"
      for (const layerId of layerGroups[key]) map.setLayoutProperty(layerId, "visibility", visibility)
    }
  }, [activeLayers, styleReady])

  return (
    <div className="relative h-full w-full">
      <div aria-label="Mapa GIS de Lima" className="h-full w-full" ref={containerRef} role="application" />
      <Button
        className="absolute bottom-10 left-3 z-10"
        onClick={() => setBasemap((current) => (current === "streets" ? "satellite" : "streets"))}
        size="sm"
        variant="outline"
      >
        {basemap === "streets" ? "Vista satélite" : "Vista de calles"}
      </Button>
      <output
        className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground shadow-sm"
        ref={readoutRef}
      >
        Mueve el cursor para ver longitud y latitud
      </output>
    </div>
  )
}

export const MapView = memo(MapViewComponent)
