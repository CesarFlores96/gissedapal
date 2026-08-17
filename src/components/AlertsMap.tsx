import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FeatureCollection, Point } from "geojson"

import type { ConsumptionDrop } from "../types"

const SOURCE_ID = "alert-points-source"
const POINT_LAYER_ID = "alert-points"
const HALO_LAYER_ID = "alert-points-halo"

type AlertPointProperties = {
  alertKey: string
  kind: ConsumptionDrop["kind"]
  selected: boolean
  supplyCode: string
}

type AlertsMapProps = {
  alerts: ConsumptionDrop[]
  loading: boolean
  onSelect: (alert: ConsumptionDrop) => void
  resultKey: string | null
  selectedAlert: ConsumptionDrop | null
}

function alertKey(alert: ConsumptionDrop): string {
  return `${alert.analysisScope ?? "supply"}:${alert.propertyCode ?? ""}:${alert.supplyCode}:${alert.period}`
}

function validPoint(geometry: unknown): geometry is Point {
  if (!geometry || typeof geometry !== "object" || !("type" in geometry) || !("coordinates" in geometry)) return false
  const candidate = geometry as Point
  return candidate.type === "Point"
    && candidate.coordinates.length >= 2
    && Number.isFinite(candidate.coordinates[0])
    && Number.isFinite(candidate.coordinates[1])
}

function buildAlertFeatures(
  alerts: ConsumptionDrop[],
  selectedAlert: ConsumptionDrop | null,
): FeatureCollection<Point, AlertPointProperties> {
  const selectedKey = selectedAlert ? alertKey(selectedAlert) : null
  const features: FeatureCollection<Point, AlertPointProperties>["features"] = []
  const seen = new Set<string>()

  for (const alert of alerts) {
    const key = alertKey(alert)
    const points = alert.analysisScope === "property" && alert.supplyPoints?.length
      ? alert.supplyPoints
      : [{ supplyCode: alert.supplyCode, geometry: alert.geometry ?? null }]

    for (const point of points) {
      if (!validPoint(point.geometry)) continue
      const pointKey = `${key}:${point.supplyCode}`
      if (seen.has(pointKey)) continue
      seen.add(pointKey)
      features.push({
        type: "Feature",
        id: pointKey,
        geometry: point.geometry,
        properties: {
          alertKey: key,
          kind: alert.kind,
          selected: key === selectedKey,
          supplyCode: point.supplyCode,
        },
      })
    }
  }

  return { type: "FeatureCollection", features }
}

function fitFeatures(map: MapLibreMap, features: FeatureCollection<Point, AlertPointProperties>["features"]): void {
  if (!features.length) return
  if (features.length === 1) {
    const coordinates = features[0].geometry.coordinates
    map.easeTo({ center: [coordinates[0], coordinates[1]], zoom: 15, duration: 550, essential: true })
    return
  }
  const bounds = new maplibregl.LngLatBounds()
  for (const feature of features) {
    const coordinates = feature.geometry.coordinates
    bounds.extend([coordinates[0], coordinates[1]])
  }
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 72, maxZoom: 15.5, duration: 650 })
  }
}

export function AlertsMap({ alerts, loading, onSelect, resultKey, selectedAlert }: AlertsMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const alertsByKeyRef = useRef(new Map<string, ConsumptionDrop>())
  const onSelectRef = useRef(onSelect)
  const lastFitResultKeyRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const featureCollection = useMemo(
    () => buildAlertFeatures(alerts, selectedAlert),
    [alerts, selectedAlert],
  )

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => {
    alertsByKeyRef.current = new Map(alerts.map((alert) => [alertKey(alert), alert]))
  }, [alerts])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: false,
      center: [-77.042793, -12.046374],
      zoom: 10.4,
      maxTileCacheSize: 48,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "map-background", type: "background", paint: { "background-color": "#dbe4e8" } },
          { id: "osm", type: "raster", source: "osm" },
        ],
      },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    map.on("load", () => {
      map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({
        id: HALO_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "selected"], "#0284c7", ["match", ["get", "kind"], "zero", "#dc2626", "#d97706"]],
          "circle-radius": ["case", ["get", "selected"], 15, 11],
          "circle-opacity": ["case", ["get", "selected"], 0.22, 0.12],
        },
      })
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-color": ["match", ["get", "kind"], "zero", "#dc2626", "#d97706"],
          "circle-radius": ["case", ["get", "selected"], 8, 6],
          "circle-stroke-color": ["case", ["get", "selected"], "#075985", "#ffffff"],
          "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
        },
      })
      map.on("click", POINT_LAYER_ID, (event) => {
        const key = event.features?.[0]?.properties?.alertKey
        if (typeof key !== "string") return
        const alert = alertsByKeyRef.current.get(key)
        if (alert) onSelectRef.current(alert)
      })
      map.on("mouseenter", POINT_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer" })
      map.on("mouseleave", POINT_LAYER_ID, () => { map.getCanvas().style.cursor = "" })
      setReady(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(featureCollection)
    if (resultKey && lastFitResultKeyRef.current !== resultKey && featureCollection.features.length) {
      lastFitResultKeyRef.current = resultKey
      fitFeatures(map, featureCollection.features)
    }
  }, [featureCollection, ready, resultKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selectedAlert) return
    const key = alertKey(selectedAlert)
    const selectedFeatures = featureCollection.features.filter((feature) => feature.properties.alertKey === key)
    fitFeatures(map, selectedFeatures)
  }, [featureCollection, ready, selectedAlert])

  const locatedAlertCount = new Set(featureCollection.features.map((feature) => feature.properties.alertKey)).size

  return (
    <main className="pointer-events-auto absolute inset-0 bg-muted" aria-label="Mapa de alertas de consumo">
      <div className="h-full w-full" ref={containerRef} />

      <div className="absolute left-[432px] top-3 hidden rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm md:block">
        <div className="flex items-center gap-3 text-[11px] font-medium text-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-destructive" /> Consumo cero</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-600" /> Caída fuerte</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {locatedAlertCount} {locatedAlertCount === 1 ? "alerta ubicada" : "alertas ubicadas"}
        </p>
      </div>

      {!loading && alerts.length === 0 ? (
        <div className="absolute left-1/2 top-1/2 hidden w-64 -translate-y-1/2 rounded-lg border bg-background/95 px-4 py-3 text-center shadow-sm md:block">
          <p className="text-xs font-semibold text-foreground">Sin alertas para mostrar</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Ejecuta una búsqueda para ubicar sus resultados.</p>
        </div>
      ) : !loading && alerts.length > 0 && featureCollection.features.length === 0 ? (
        <div className="absolute left-1/2 top-1/2 hidden w-64 -translate-y-1/2 rounded-lg border bg-background/95 px-4 py-3 text-center shadow-sm md:block">
          <p className="text-xs font-semibold text-foreground">Alertas sin ubicación disponible</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Los resultados permanecen disponibles en la lista.</p>
        </div>
      ) : null}
    </main>
  )
}
