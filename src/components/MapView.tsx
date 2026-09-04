import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type VectorTileSource } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { FeatureCollection, Geometry, Point } from "geojson"

import { getLotContext, getTileServerUrl } from "../features/map/lotContext"
import { getAnaWells } from "../features/map/anaWells"
import { observeMapPerformance } from "../features/map/mapPerformance"
import { dedupeExactBlockGeometries } from "../features/map/dedupeCadastral"
import type { CadastralSelection, DistrictOption, GisLayersResponse, LayerKey, PlaceLocation, SupplyDetail, SupplyFocusPoint } from "../types"
import { Button } from "./ui/Button"

const sourceIds: Record<LayerKey, string> = {
  distritos: "districts-source",
  manzanas: "blocks-source",
  cuadrantes: "quadrants-source",
  lotes: "local-lots",
  tuberias: "water-pipes-source",
  conexiones: "water-connections-source",
  alcantarillado: "sewer-source",
  suministros: "supplies-source",
  medidores: "meters-source",
  pozos_ana: "ana-wells-source",
}

const layerGroups: Record<LayerKey, string[]> = {
  distritos: ["district-mask", "district-fill", "district-line"],
  manzanas: ["block-fill", "block-line", "block-label", "selected-block-fill", "selected-block-line"],
  cuadrantes: ["quadrant-fill", "quadrant-line"],
  lotes: [
    "lot-fill", "lot-line", "lot-label",
    "moving-block-lots-fill", "moving-block-lots-line", "moving-block-lots-label",
    "selected-lot-fill", "selected-lot-line",
  ],
  tuberias: [
    "water-pipes-casing",
    "water-pipes-line",
    "water-pipes-label",
    "water-pipes-hover",
    "water-pipes-hit",
  ],
  conexiones: ["water-connections-line", "water-connections-marker"],
  alcantarillado: ["sewer-line"],
  suministros: ["supply-points"],
  medidores: ["meter-points"],
  pozos_ana: ["ana-wells-points"],
}

const emptyCollection: FeatureCollection<Geometry, Record<string, unknown>> = { type: "FeatureCollection", features: [] }
const districtColor = "#0ea5e9"
const supplyColor = "#06b6d4"
// Cambiar la clave cuando cambie la geometria generada por mvt.lots evita que
// MapLibre reutilice teselas previas a las correcciones catastrales.
const lotTileSchemaVersion = "2026-08-14-cadastral-corrections-v2"
const waterTileSchemaVersion = "2026-08-31-secondary-network-v1"
const TILE_SESSION_REFRESH_MS = 5 * 60 * 1000
type PersistedMapCamera = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}
let persistedMapCamera: PersistedMapCamera = {
  center: [-77.042793, -12.046374],
  zoom: 10.4,
  bearing: 0,
  pitch: 0,
}
let persistedBasemap: "streets" | "satellite" = "streets"

function lotTileUrl(tileBaseUrl: string, revision: number): string {
  return `${tileBaseUrl}/mvt.lots/{z}/{x}/{y}?schema=${lotTileSchemaVersion}&revision=${revision}`
}

function waterPipeTileUrl(tileBaseUrl: string, revision: number): string {
  return `${tileBaseUrl}/mvt.water_pipes/{z}/{x}/{y}?schema=${waterTileSchemaVersion}&revision=${revision}`
}

function waterConnectionTileUrl(tileBaseUrl: string, revision: number): string {
  return `${tileBaseUrl}/mvt.water_connections/{z}/{x}/{y}?schema=${waterTileSchemaVersion}&revision=${revision}`
}

/** Duración del atenuado al filtrar por distrito. */
const FADE_MS = 420

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
  cadastralRevision: number
  networkRevision: number
  data: GisLayersResponse | null
  focusedPlace: PlaceLocation | null
  focusedPlaceFocusToken: number
  focusedSupplyFocusToken: number
  focusedSupply: SupplyDetail | null
  focusedSupplyGroup: SupplyFocusPoint[]
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

function buildFocusedFeatures(
  group: SupplyFocusPoint[],
  focusedSupply: SupplyDetail | null,
): FeatureCollection<Geometry, Record<string, unknown>> {
  const fallbackGeometry = focusedSupply?.geometry?.type === "Point" ? focusedSupply.geometry : null
  if (!group.length) {
    return fallbackGeometry ? {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: fallbackGeometry,
        properties: { supplyCode: focusedSupply?.supply.code ?? "", provisional: false },
      }],
    } : emptyCollection
  }
  const exactAnchor = group.find((point) => point.geometry?.type === "Point")?.geometry
  const anchor = exactAnchor?.type === "Point" ? exactAnchor : fallbackGeometry
  if (!anchor) return emptyCollection
  let provisionalIndex = 0
  return {
    type: "FeatureCollection",
    features: group.map((point) => {
      const exactGeometry = point.geometry?.type === "Point" ? point.geometry : null
      const hasExactPoint = exactGeometry !== null
      let geometry: Point = exactGeometry ?? anchor
      if (!hasExactPoint) {
        const angle = (provisionalIndex * Math.PI * 2) / Math.max(group.length - 1, 1)
        const radius = 0.000035
        provisionalIndex += 1
        geometry = {
          type: "Point",
          coordinates: [
            anchor.coordinates[0] + Math.cos(angle) * radius,
            anchor.coordinates[1] + Math.sin(angle) * radius,
          ],
        }
      }
      return {
        type: "Feature",
        geometry,
        properties: {
          supplyCode: point.supplyCode,
          provisional: !hasExactPoint,
        },
      }
    }),
  }
}

/**
 * Fuentes y capas del visor.
 *
 * Las opciones `tolerance`/`buffer`/`maxzoom` de las fuentes GeoJSON reducen el
 * teselado que MapLibre hace en el hilo principal, que era una de las causas del
 * tirón al panear con catastro activo.
 */
function addSourcesAndLayers(map: MapLibreMap, tileBaseUrl: string, cadastralRevision: number, networkRevision: number): void {
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
      "fill-color": districtColor,
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
      "fill-extrusion-color": districtColor,
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
    minzoom: 15.6,
    layout: {
      "text-field": ["concat", "MZ ", ["get", "block_code"]],
      "text-size": 11,
      "text-allow-overlap": false,
      "text-padding": 18,
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
  map.addSource(sourceIds.lotes, {
    type: "vector",
    tiles: [lotTileUrl(tileBaseUrl, cadastralRevision)],
    minzoom: 15,
    maxzoom: 22,
    promoteId: "record_id",
  })
  map.addLayer({
    id: "lot-fill",
    type: "fill",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    paint: {
      "fill-color": ["match", ["get", "lot_type_code"], "TL003", "#4d9b62", "TL005", "#65a96f", "TL002", "#94a3b8", "TL001", "#b8b8b8", "#d6a756"],
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.24, 17, 0.18, 19, 0.14],
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
    "source-layer": "lots",
    minzoom: 15,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      // Antes era gris pizarra a 0.5-0.6 de opacidad y 0.7-1.15px: contra el
      // basemap OSM y las lineas azules de manzana quedaba prácticamente
      // invisible. Ambar (coincide con el swatch de "Lotes" del panel de capas)
      // y más grosor/opacidad para que el contorno del lote se distinga.
      "line-color": "#d97706",
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1.1, 17, 1.5, 19, 1.9],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.75, 17, 0.85, 19, 0.9],
      "line-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "lot-label",
    type: "symbol",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    layout: {
      "text-field": ["get", "display_code"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 8, 17, 10, 19, 11],
      // La misma geometría puede cruzar dos teselas. Permitir solapes hacía que
      // MapLibre colocara su código una vez por tesela (3115, 7469, etc.).
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 2,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "area_m2"], 0]],
    },
    paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.3 },
  })
  // Los lotes viven en una fuente MVT y no pasan por previewCollection. Estas
  // capas duplican solo los hijos de la manzana que se esta ajustando para que
  // el usuario vea el conjunto completo moverse durante el arrastre.
  map.addLayer({
    id: "moving-block-lots-fill",
    type: "fill",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    filter: ["==", ["get", "block_id"], ""],
    paint: {
      "fill-color": ["match", ["get", "lot_type_code"], "TL003", "#4d9b62", "TL005", "#65a96f", "TL002", "#94a3b8", "TL001", "#b8b8b8", "#d6a756"],
      "fill-opacity": 0.24,
      "fill-outline-color": "rgba(0, 0, 0, 0)",
      "fill-translate": [0, 0],
      "fill-translate-anchor": "viewport",
    },
  })
  map.addLayer({
    id: "moving-block-lots-line",
    type: "line",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    filter: ["==", ["get", "block_id"], ""],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#d97706",
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1.1, 17, 1.5, 19, 1.9],
      "line-opacity": 0.85,
      "line-translate": [0, 0],
      "line-translate-anchor": "viewport",
    },
  })
  map.addLayer({
    id: "moving-block-lots-label",
    type: "symbol",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    filter: ["==", ["get", "block_id"], ""],
    layout: {
      "text-field": ["get", "display_code"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 8, 17, 10, 19, 11],
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 2,
    },
    paint: {
      "text-color": "#1f2937",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.3,
      "text-translate": [0, 0],
      "text-translate-anchor": "viewport",
    },
  })
  map.addLayer({
    id: "selected-lot-fill",
    type: "fill",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    filter: ["==", ["get", "lot_code"], ""],
    paint: { "fill-color": "#fdba74", "fill-opacity": 0.34 },
  })
  map.addLayer({
    id: "selected-lot-line",
    type: "line",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    filter: ["==", ["get", "lot_code"], ""],
    paint: { "line-color": "#f97316", "line-width": 3.5 },
  })
  map.addLayer({
    id: "lot-building-extrusion",
    type: "fill-extrusion",
    source: sourceIds.lotes,
    "source-layer": "lots",
    minzoom: 15,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": ["match", ["get", "lot_type_code"], "TL003", "#4d9b62", "TL005", "#65a96f", "TL001", "#a3a3a3", "#c6903f"],
      "fill-extrusion-height": ["interpolate", ["linear"], ["coalesce", ["get", "levels"], 0], 0, 1.2, 1, 3, 5, 15, 20, 60],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.72,
    },
  })

  map.addSource(sourceIds.tuberias, {
    type: "vector",
    tiles: [waterPipeTileUrl(tileBaseUrl, networkRevision)],
    minzoom: 12,
    maxzoom: 22,
  })
  // La red es densa: una sola capa visual evita repintar cada tesela varias
  // veces. La selección conserva un hit-area ancho y un resaltado separado.
  // La vista general conserva una sola línea. A escala técnica se añade una
  // camisa clara y el rótulo de material/diámetro que ya entrega el MVT.
  map.addLayer({ id: "water-pipes-casing", type: "line", source: sourceIds.tuberias, "source-layer": "water_pipes", minzoom: 16, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f8fafc", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 5.8, 20, 9.4], "line-opacity": 0.9 } })
  map.addLayer({ id: "water-pipes-line", type: "line", source: sourceIds.tuberias, "source-layer": "water_pipes", minzoom: 12, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["match", ["get", "network_level"], "primaria", "#075985", "secundaria", "#0284c7", "#0369a1"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.4, 18, 4.2], "line-opacity": 0.92, "line-opacity-transition": { duration: FADE_MS, delay: 0 } } })
  map.addLayer({ id: "water-pipes-label", type: "symbol", source: sourceIds.tuberias, "source-layer": "water_pipes", minzoom: 17, layout: { "symbol-placement": "line", "symbol-spacing": 420, "text-field": ["concat", ["upcase", ["coalesce", ["get", "material"], "AGUA"]], " Ø", ["to-string", ["coalesce", ["get", "diameter_mm"], "?"]], " mm"], "text-size": ["interpolate", ["linear"], ["zoom"], 17, 10, 20, 12], "text-max-angle": 35, "text-padding": 3, "text-keep-upright": true }, paint: { "text-color": "#075985", "text-halo-color": "#ffffff", "text-halo-width": 1.4, "text-halo-blur": 0.35 } })
  const emptyPipeFilter: maplibregl.FilterSpecification = ["==", ["get", "id"], ""]
  map.addLayer({ id: "water-pipes-hover", type: "line", source: sourceIds.tuberias, "source-layer": "water_pipes", minzoom: 12, filter: emptyPipeFilter, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#22d3ee", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 18, 8], "line-opacity": 0.95 } })
  map.addLayer({ id: "water-pipes-hit", type: "line", source: sourceIds.tuberias, "source-layer": "water_pipes", minzoom: 12, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 12, 18, 18], "line-opacity": 0.01 } })

  map.addSource(sourceIds.conexiones, {
    type: "vector",
    tiles: [waterConnectionTileUrl(tileBaseUrl, networkRevision)],
    minzoom: 16,
    maxzoom: 22,
  })
  map.addLayer({ id: "water-connections-line", type: "line", source: sourceIds.conexiones, "source-layer": "water_connections", minzoom: 16, paint: { "line-color": "#22d3ee", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.9, 20, 1.8], "line-opacity": 0.76, "line-opacity-transition": { duration: FADE_MS, delay: 0 } } })
  map.addLayer({ id: "water-connections-marker", type: "symbol", source: sourceIds.conexiones, "source-layer": "water_connections", minzoom: 18, layout: { "symbol-placement": "line", "symbol-spacing": 96, "text-field": "▪", "text-size": 7, "text-allow-overlap": true, "text-keep-upright": true }, paint: { "text-color": "#0ea5e9", "text-halo-color": "#ffffff", "text-halo-width": 0.8 } })

  map.addSource(sourceIds.alcantarillado, { ...vectorSource, data: emptyCollection, lineMetrics: true })
  map.addLayer({ id: "sewer-line", type: "line", source: sourceIds.alcantarillado, paint: { "line-color": "#b45309", "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity-transition": { duration: FADE_MS, delay: 0 } } })

  // Cada suministro se representa como un punto desde el primer nivel de zoom.
  // No se usa cluster: ocultaba los NIS bajo un contador y obligaba a acercarse.
  map.addSource(sourceIds.suministros, { type: "geojson", data: emptyCollection, cluster: false })
  map.addLayer({ id: "supply-points", type: "circle", source: sourceIds.suministros, paint: { "circle-color": supplyColor, "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 17, 9], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.35, "circle-opacity-transition": { duration: FADE_MS, delay: 0 } } })

  map.addSource(sourceIds.pozos_ana, { type: "geojson", data: emptyCollection, cluster: false })
  map.addLayer({
    id: "ana-wells-points",
    type: "circle",
    source: sourceIds.pozos_ana,
    paint: {
      "circle-color": "#f59e0b",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 5, 17, 7],
      "circle-stroke-color": "#78350f",
      "circle-stroke-width": 1.2,
      "circle-opacity-transition": { duration: FADE_MS, delay: 0 },
    },
  })

  map.addSource("focused-supply-source", { type: "geojson", data: emptyCollection })
  map.addLayer({ id: "focused-supply-halo", type: "circle", source: "focused-supply-source", paint: { "circle-color": "#f97316", "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 19, 17, 29], "circle-opacity": 0.22, "circle-stroke-color": "#fff7ed", "circle-stroke-width": 3 } })
  map.addLayer({ id: "focused-supply-point", type: "circle", source: "focused-supply-source", paint: { "circle-color": ["case", ["get", "provisional"], "#0ea5e9", "#f97316"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 17, 12], "circle-stroke-color": ["case", ["get", "provisional"], "#075985", "#7c2d12"], "circle-stroke-width": 2.5 } })
  map.addLayer({ id: "focused-supply-label", type: "symbol", source: "focused-supply-source", minzoom: 14, layout: { "text-field": ["get", "supplyCode"], "text-size": 11, "text-offset": [0, 1.8], "text-anchor": "top", "text-allow-overlap": true }, paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } })

  map.addSource(sourceIds.medidores, { type: "geojson", data: emptyCollection, cluster: false })
  map.addLayer({ id: "meter-points", type: "circle", source: sourceIds.medidores, minzoom: 14, paint: { "circle-color": "#22c55e", "circle-radius": 3, "circle-stroke-color": "#14532d", "circle-stroke-width": 1, "circle-opacity-transition": { duration: FADE_MS, delay: 0 } } })
}

function MapViewComponent({
  activeLayers,
  adjustmentDelta,
  adjustmentMode,
  cadastralRevision,
  networkRevision,
  data,
  focusedPlace,
  focusedPlaceFocusToken,
  focusedSupply,
  focusedSupplyGroup,
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
  const cadastralRevisionRef = useRef(cadastralRevision)
  const networkRevisionRef = useRef(networkRevision)
  const tileBaseUrlRef = useRef<string | null>(null)
  const renderedSourceDataRef = useRef<Partial<Record<LayerKey, FeatureCollection<Geometry>>>>({})
  const lastFocusKeyRef = useRef<string | null>(null)
  const appliedCadastreFocusRef = useRef<string | null>(null)
  const appliedDistrictFocusRef = useRef<string | null>(null)
  const dragStateRef = useRef<{ lng: number; lat: number; delta: { lng: number; lat: number }; moved: boolean } | null>(null)
  const placeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const suppressNextClickRef = useRef(false)
  const [basemap, setBasemap] = useState<"streets" | "satellite">(persistedBasemap)
  const [styleReady, setStyleReady] = useState(false)
  const focusedFeatures = useMemo(
    () => buildFocusedFeatures(focusedSupplyGroup, focusedSupply),
    [focusedSupply, focusedSupplyGroup],
  )

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
  useEffect(() => { cadastralRevisionRef.current = cadastralRevision }, [cadastralRevision])
  useEffect(() => { networkRevisionRef.current = networkRevision }, [networkRevision])
  useEffect(() => { persistedBasemap = basemap }, [basemap])
  useEffect(() => {
    if (!selectedCadastral) appliedCadastreFocusRef.current = null
  }, [selectedCadastral])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let disposed = false
    let tileRefreshTimer: number | null = null
    let stopPerformanceObserver: (() => void) | null = null
    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: false,
      // Lotes y manzanas resuelven colisiones dentro de su propia fuente. Así
      // cada código aparece una sola vez sin que la etiqueta MZ oculte todos
      // los códigos de lote cercanos.
      crossSourceCollisions: false,
      maxTileCacheSize: 80,
      center: persistedMapCamera.center,
      zoom: persistedMapCamera.zoom,
      bearing: persistedMapCamera.bearing,
      pitch: persistedMapCamera.pitch,
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
      const center = map.getCenter()
      persistedMapCamera = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }
      const bounds = map.getBounds()
      boundsCallbackRef.current([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getZoom())
    }

    map.on("load", () => {
      void (async () => {
        try {
          const tileBaseUrl = await getTileServerUrl()
          if (disposed) return
          tileBaseUrlRef.current = tileBaseUrl
          addSourcesAndLayers(map, tileBaseUrl, cadastralRevisionRef.current, networkRevisionRef.current)
          for (const key of Object.keys(layerGroups) as LayerKey[]) {
            const visibility = activeLayersRef.current.has(key) ? "visible" : "none"
            for (const layerId of layerGroups[key]) map.setLayoutProperty(layerId, "visibility", visibility)
          }
          stopPerformanceObserver = observeMapPerformance(map, () => (
            activeLayersRef.current.has("tuberias") || activeLayersRef.current.has("conexiones")
          ))
          publishBounds()
          setStyleReady(true)

          // La sesión firmada del backend dura diez minutos. Se renueva antes
          // de vencer y se reemplaza la plantilla sin desmontar ni mover el mapa.
          tileRefreshTimer = window.setInterval(() => {
            void getTileServerUrl().then((nextTileBaseUrl) => {
              if (disposed) return
              tileBaseUrlRef.current = nextTileBaseUrl
              const lotSource = map.getSource(sourceIds.lotes) as VectorTileSource | undefined
              lotSource?.setTiles([lotTileUrl(nextTileBaseUrl, cadastralRevisionRef.current)])
              const pipeSource = map.getSource(sourceIds.tuberias) as VectorTileSource | undefined
              pipeSource?.setTiles([waterPipeTileUrl(nextTileBaseUrl, networkRevisionRef.current)])
              const connectionSource = map.getSource(sourceIds.conexiones) as VectorTileSource | undefined
              connectionSource?.setTiles([waterConnectionTileUrl(nextTileBaseUrl, networkRevisionRef.current)])
            }).catch(() => undefined)
          }, TILE_SESSION_REFRESH_MS)
        } catch {
          if (!disposed) errorCallbackRef.current("No se pudieron cargar las teselas catastrales.")
        }
      })()
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

    const pointHitLayers = ["ana-wells-points", "supply-points", "meter-points"]
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
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      if (adjustmentModeRef.current) return

      const pointFeature = queryNearestPointFeature(event.point)
      if (pointFeature) {
        const supplyCode = pointFeature.properties?.supply_code
        if (typeof supplyCode === "string") selectCallbackRef.current(supplyCode)
        else {
          const code = String(pointFeature.properties?.CODIGO ?? "Sin código")
          const district = String(pointFeature.properties?.DISTRITO ?? "Distrito no registrado")
          const owner = String(pointFeature.properties?.PROPIETARI ?? "Propietario no registrado")
          new maplibregl.Popup({ closeButton: true, maxWidth: "18rem" })
            .setLngLat(event.lngLat)
            .setText(`Pozo ANA\n${code}\n${district}\n${owner}`)
            .addTo(map)
        }
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
    for (const layerId of ["ana-wells-points", "supply-points", "meter-points", "lot-fill", "block-fill"]) {
      map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer" })
      map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = "" })
    }

    const pipeHoverLayers = ["water-pipes-hover"]
    const clearPipeHover = (): void => {
      const emptyFilter: maplibregl.FilterSpecification = ["==", ["get", "id"], ""]
      for (const layerId of pipeHoverLayers) {
        if (map.getLayer(layerId)) map.setFilter(layerId, emptyFilter)
      }
      if (!adjustmentModeRef.current) map.getCanvas().style.cursor = ""
    }
    let pipeHoverFrame: number | null = null
    let hoveredPipeId: string | number | null = null
    const queuePipeHover = (propertyId: string | number | null, featureId: string | number | undefined): void => {
      const nextId = propertyId ?? featureId ?? null
      if (nextId === hoveredPipeId) return
      hoveredPipeId = nextId
      if (pipeHoverFrame !== null) return
      pipeHoverFrame = requestAnimationFrame(() => {
        pipeHoverFrame = null
        const filter: maplibregl.FilterSpecification = hoveredPipeId !== null
          ? ["==", ["get", "id"], hoveredPipeId]
          : ["==", ["get", "id"], ""]
        for (const layerId of pipeHoverLayers) {
          if (map.getLayer(layerId)) map.setFilter(layerId, filter)
        }
      })
    }
    map.on("mousemove", "water-pipes-hit", (event) => {
      const pipe = event.features?.[0]
      if (!pipe) {
        clearPipeHover()
        return
      }

      const propertyId = pipe.properties?.id
      queuePipeHover(typeof propertyId === "string" || typeof propertyId === "number" ? propertyId : null, pipe.id)
      map.getCanvas().style.cursor = "pointer"
    })
    map.on("mouseleave", "water-pipes-hit", () => {
      hoveredPipeId = null
      clearPipeHover()
    })

    const finishSelectedDrag = (): void => {
      if (!dragStateRef.current) return
      suppressNextClickRef.current = dragStateRef.current.moved
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
      dragStateRef.current = { lng: event.lngLat.lng, lat: event.lngLat.lat, delta: adjustmentDeltaRef.current, moved: false }
      map.dragPan.disable()
      map.getCanvas().style.cursor = "grabbing"
    }

    map.on("mousedown", "lot-fill", (event) => startSelectedDrag("lot", event))
    map.on("mousedown", "block-fill", (event) => startSelectedDrag("block", event))
    map.on("mousemove", (event) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      if (!dragState.moved) {
        const movedLng = Math.abs(event.lngLat.lng - dragState.lng)
        const movedLat = Math.abs(event.lngLat.lat - dragState.lat)
        dragState.moved = movedLng > 0.0000005 || movedLat > 0.0000005
      }
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
      if (tileRefreshTimer !== null) window.clearInterval(tileRefreshTimer)
      stopPerformanceObserver?.()
      window.removeEventListener("mouseup", finishSelectedDrag)
      const center = map.getCenter()
      persistedMapCamera = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }
      map.remove()
      mapRef.current = null
      setStyleReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const tileBaseUrl = tileBaseUrlRef.current
    if (!map || !styleReady || !tileBaseUrl) return
    const source = map.getSource(sourceIds.lotes) as VectorTileSource | undefined
    source?.setTiles([lotTileUrl(tileBaseUrl, cadastralRevision)])
    map.triggerRepaint()
  }, [cadastralRevision, styleReady])

  useEffect(() => {
    const map = mapRef.current
    const tileBaseUrl = tileBaseUrlRef.current
    if (!map || !styleReady || !tileBaseUrl) return
    const pipeSource = map.getSource(sourceIds.tuberias) as VectorTileSource | undefined
    pipeSource?.setTiles([waterPipeTileUrl(tileBaseUrl, networkRevision)])
    const connectionSource = map.getSource(sourceIds.conexiones) as VectorTileSource | undefined
    connectionSource?.setTiles([waterConnectionTileUrl(tileBaseUrl, networkRevision)])
    map.triggerRepaint()
  }, [networkRevision, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.setLayoutProperty("osm", "visibility", basemap === "streets" ? "visible" : "none")
    map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none")
  }, [basemap, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const source = map.getSource("focused-supply-source") as GeoJSONSource | undefined
    source?.setData(focusedFeatures)
  }, [focusedFeatures, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !data) return
    for (const [key, payload] of Object.entries(data.layers)) {
      if (!payload) continue
      const layerKey = key as LayerKey
      if (["lotes", "tuberias", "conexiones"].includes(layerKey)) continue
      const renderData = layerKey === "manzanas"
        ? dedupeExactBlockGeometries(payload.data)
        : payload.data
      // La respuesta de una capa no debe retesselar todas las demás fuentes.
      // Esto también evita redibujar distritos y suministros al completar lotes.
      const nextData = adjustmentMode
        ? previewCollection(renderData, layerKey, selectedCadastral, adjustmentDelta)
        : renderData
      if (renderedSourceDataRef.current[layerKey] === nextData) continue
      const source = map.getSource(sourceIds[layerKey]) as GeoJSONSource | undefined
      source?.setData(nextData)
      renderedSourceDataRef.current[layerKey] = nextData
    }
  }, [adjustmentDelta, adjustmentMode, data, selectedCadastral, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !activeLayers.has("pozos_ana")) return
    let cancelled = false
    void getAnaWells()
      .then((wells) => {
        if (cancelled) return
        const source = map.getSource(sourceIds.pozos_ana) as GeoJSONSource | undefined
        source?.setData(wells)
      })
      .catch(() => {
        if (!cancelled) errorCallbackRef.current("No se pudo cargar la capa de pozos ANA.")
      })
    return () => { cancelled = true }
  }, [activeLayers, styleReady])

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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const editingBlock = adjustmentMode && selectedCadastral?.kind === "block"
      ? selectedCadastral
      : null
    const blockCode = String(editingBlock?.properties.block_code ?? "").trim()
    const movingFilter: maplibregl.FilterSpecification = editingBlock
      ? [
          "any",
          ["==", ["get", "block_id"], editingBlock.id],
          ["==", ["get", "block_code"], blockCode],
        ]
      : ["==", ["get", "block_id"], ""]
    const baseFilter: maplibregl.FilterSpecification | null = editingBlock
      ? ["!", movingFilter]
      : null

    for (const layerId of ["lot-fill", "lot-line", "lot-label"]) map.setFilter(layerId, baseFilter)
    for (const layerId of ["moving-block-lots-fill", "moving-block-lots-line", "moving-block-lots-label"]) {
      map.setFilter(layerId, movingFilter)
    }

    const updateChildLotTranslation = (): void => {
      const center = selectionCenter(editingBlock)
      let translation: [number, number] = [0, 0]
      if (center) {
        const origin = map.project(center)
        const target = map.project([
          center[0] + adjustmentDelta.lng,
          center[1] + adjustmentDelta.lat,
        ])
        translation = [target.x - origin.x, target.y - origin.y]
      }
      map.setPaintProperty("moving-block-lots-fill", "fill-translate", translation)
      map.setPaintProperty("moving-block-lots-line", "line-translate", translation)
      map.setPaintProperty("moving-block-lots-label", "text-translate", translation)
    }

    updateChildLotTranslation()
    if (!editingBlock) return
    map.on("move", updateChildLotTranslation)
    return () => { map.off("move", updateChildLotTranslation) }
  }, [adjustmentDelta, adjustmentMode, selectedCadastral, styleReady])

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
        ? ["case", isSelected("district"), ["interpolate", ["linear"], ["zoom"], 15, 0.28, 17, 0.21, 19, 0.17], 0.03]
        : ["interpolate", ["linear"], ["zoom"], 15, 0.24, 17, 0.18, 19, 0.14],
    )
    map.setPaintProperty(
      "lot-line",
      "line-opacity",
      name
        ? ["case", isSelected("district"), ["interpolate", ["linear"], ["zoom"], 15, 0.58, 17, 0.56, 19, 0.62], 0.08]
        : ["interpolate", ["linear"], ["zoom"], 15, 0.5, 17, 0.54, 19, 0.6],
    )
    for (const layerId of ["sewer-line", "quadrant-line"]) {
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
    const showsLots = activeLayersRef.current.has("lotes")
    const focusKey = `district:${selectedDistrict.name}`
    if (appliedDistrictFocusRef.current === focusKey) return
    appliedDistrictFocusRef.current = focusKey
    lastFocusKeyRef.current = focusKey

    const [minLng, minLat, maxLng, maxLat] = selectedDistrict.bounds
    map.stop()
    const padding = { top: 80, right: 400, bottom: 80, left: 80 }
    const camera = map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], { padding, maxZoom: 14.5 })
    if (!camera) return
    // La envolvente puede abarcar zonas vecinas en distritos irregulares. El
    // catalogo tambien entrega un punto garantizado dentro del poligono; usarlo
    // como centro evita que el encuadre visual se desplace hacia Santa Anita.
    const center = selectedDistrict.center ?? camera.center
    // La fuente MVT de lotes empieza en z15. Si la capa está activa, un
    // encuadre distrital por debajo de ese nivel hacía que pareciera vacía.
    const cameraZoom = camera.zoom ?? map.getZoom()
    const zoom = showsLots ? Math.max(cameraZoom, 15.2) : cameraZoom
    map.flyTo({ ...camera, center, zoom, duration: 1200, essential: true })
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
    const pointFeatures = focusedFeatures.features.filter((feature) => feature.geometry.type === "Point")
    if (!pointFeatures.length) return
    const focusKey = focusedSupplyGroup.length
      ? `supply-group:${focusedSupplyGroup.map((point) => point.supplyCode).join(",")}:${focusedSupplyFocusToken}`
      : `supply:${focusedSupply?.supply.code ?? ""}:${focusedSupplyFocusToken}`
    if (lastFocusKeyRef.current === focusKey) return
    lastFocusKeyRef.current = focusKey
    map.stop()
    if (pointFeatures.length > 1) {
      const bounds = new maplibregl.LngLatBounds()
      for (const feature of pointFeatures) {
        if (feature.geometry.type === "Point") bounds.extend(feature.geometry.coordinates as [number, number])
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 120, right: 460, bottom: 120, left: 90 },
          maxZoom: 18.5,
          duration: 950,
        })
      }
      return
    }
    const geometry = pointFeatures[0].geometry
    if (geometry.type !== "Point") return
    const [lng, lat] = geometry.coordinates
    if (typeof lng !== "number" || typeof lat !== "number") return
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
  }, [focusedFeatures, focusedSupply, focusedSupplyFocusToken, focusedSupplyGroup, styleReady, threeDimensional])

  // Foco de un lugar elegido en el buscador de mapa. Sin geometría propia (no
  // es catastro ni suministro), así que además de centrar la cámara hace falta
  // un pin -- el token fuerza el re-encuadre aunque se reelija el mismo lugar.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!focusedPlace) {
      placeMarkerRef.current?.remove()
      placeMarkerRef.current = null
      return
    }
    const marker = placeMarkerRef.current ?? new maplibregl.Marker({ color: "#dc2626" })
    placeMarkerRef.current = marker
    marker.setLngLat([focusedPlace.lng, focusedPlace.lat]).addTo(map)
  }, [focusedPlace])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !focusedPlace) return
    map.stop()
    const targetZoom = Math.max(map.getZoom(), 17)
    map.easeTo({
      center: [focusedPlace.lng, focusedPlace.lat],
      zoom: targetZoom,
      pitch: threeDimensional ? 55 : 25,
      duration: 1200,
      essential: true,
    })
  }, [focusedPlace, focusedPlaceFocusToken, styleReady, threeDimensional])

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
