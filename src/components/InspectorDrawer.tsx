import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Copy,
  Gauge,
  Globe,
  LandPlot,
  MapPin,
  Move,
  PersonStanding,
  RotateCcw,
  Ruler,
  Save,
  X,
} from "lucide-react"
import { useState } from "react"

import { openMapsWindow, type MapsWindowMode } from "../lib/ipc"
import { useDelayedUnmount } from "../lib/useDelayedUnmount"
import type { CadastralSelection, RelationshipResult, SupplyDetail } from "../types"
import { Badge, Button, IconButton, Panel } from "./ui"

type InspectorDrawerProps = {
  adjustmentDelta: { lng: number; lat: number }
  adjustmentMode: boolean
  adjustmentNotice: string | null
  adjustmentSaving: boolean
  cadastral: CadastralSelection | null
  detail: SupplyDetail | null
  loading: boolean
  onAdjustmentCancel: () => void
  onAdjustmentNudge: (eastMeters: number, northMeters: number) => void
  onAdjustmentReset: () => void
  onAdjustmentSave: () => void
  onAdjustmentStart: (target: "selection" | "block") => void
  onClose: () => void
  onError: (message: string) => void
  onOpenReport: (supplyCode: string) => void
  onViewCadastralLink: (link: NonNullable<SupplyDetail["cadastralLink"]>) => void
  relation: RelationshipResult | null
}

/** Duración de la transición de salida del sheet; debe calzar con `duration-*` en el JSX. */
const CLOSE_TRANSITION_MS = 280

const lotTypeLabels: Record<string, string> = {
  TL001: "Predio",
  TL002: "Berma",
  TL003: "Parque",
  TL004: "Óvalo",
  TL005: "Área verde",
  TL006: "Costa Verde",
  TL007: "Huaca",
  TL008: "Solar",
  TL009: "Zona agrícola",
}

function propertyText(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key]
  if (typeof value !== "string" && typeof value !== "number") return null
  return String(value).trim() || null
}

function measurementText(properties: Record<string, unknown>, key: string, unit: string): string | null {
  const value = properties[key]
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: 2 })} ${unit}`
}

function coordinatesText(lng?: number | null, lat?: number | null): string | null {
  if (typeof lng !== "number" || !Number.isFinite(lng) || typeof lat !== "number" || !Number.isFinite(lat)) return null
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window
}

function Value({ label, value }: { label: string; value: string | null | undefined }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-fg">{value || "No registrado"}</dd>
    </div>
  )
}

/**
 * Abre Google Maps en una ventana de la aplicación.
 *
 * Antes esto delegaba en el plugin `opener`, que lanzaba el navegador del
 * sistema y sacaba al usuario de la app; el `window.open` de respaldo no hace
 * nada dentro de un webview de Tauri, así que el botón parecía roto.
 */
function MapsActions({
  lat,
  lng,
  onError,
  onOpenReport,
  supplyCode,
}: {
  lat: number | null | undefined
  lng: number | null | undefined
  onError: (message: string) => void
  onOpenReport?: (supplyCode: string) => void
  supplyCode?: string
}): React.JSX.Element | null {
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
    return null
  }

  const open = (mode: MapsWindowMode): void => {
    if (!isTauriRuntime()) {
      const url =
        mode === "streetview"
          ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`
          : `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}&basemap=satellite`
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    void openMapsWindow(lat, lng, mode).catch(() => {
      onError("No se pudo abrir la ventana de Google Maps.")
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        icon={<Globe aria-hidden="true" size={15} strokeWidth={1.75} />}
        label="Abrir vista satélite en Google Maps"
        onClick={() => open("satellite")}
        size="sm"
      />
      <IconButton
        icon={<PersonStanding aria-hidden="true" size={15} strokeWidth={1.75} />}
        label="Abrir Street View en Google Maps"
        onClick={() => open("streetview")}
        size="sm"
      />
      {onOpenReport && supplyCode ? (
        <IconButton
          icon={<BarChart3 aria-hidden="true" size={15} strokeWidth={1.75} />}
          label="Ver reporte de consumo"
          onClick={() => onOpenReport(supplyCode)}
          size="sm"
        />
      ) : null}
    </div>
  )
}

export function InspectorDrawer({
  adjustmentDelta,
  adjustmentMode,
  adjustmentNotice,
  adjustmentSaving,
  cadastral,
  detail,
  loading,
  onAdjustmentCancel,
  onAdjustmentNudge,
  onAdjustmentReset,
  onAdjustmentSave,
  onAdjustmentStart,
  onClose,
  onError,
  onOpenReport,
  onViewCadastralLink,
  relation,
}: InspectorDrawerProps): React.JSX.Element | null {
  const [copiedCoordinates, setCopiedCoordinates] = useState(false)
  const open = Boolean(detail || relation || cadastral || loading)
  const mounted = useDelayedUnmount(open, CLOSE_TRANSITION_MS)

  // Congela el contenido mostrado mientras el sheet se cierra: los props reales
  // ya volvieron a null en cuanto se llama a onClose, y sin esto la animación
  // de salida se vería vacía en vez de mostrar la última ficha consultada.
  // Se sincroniza ajustando el estado durante el render (no en un efecto ni
  // leyendo un ref): las reglas de hooks de este proyecto prohíben leer
  // `ref.current` en el cuerpo del render.
  const [frozen, setFrozen] = useState({ cadastral, detail, loading, relation })
  if (open && (frozen.cadastral !== cadastral || frozen.detail !== detail || frozen.loading !== loading || frozen.relation !== relation)) {
    setFrozen({ cadastral, detail, loading, relation })
  }
  const content = open ? { cadastral, detail, loading, relation } : frozen

  if (!mounted) return null

  const cadastralCode = content.cadastral?.kind === "lot"
    ? propertyText(content.cadastral.properties, "lot_code")
    : propertyText(content.cadastral?.properties ?? {}, "block_code")
  const hasCorrection = Boolean(
    content.cadastral
    && ((Number(content.cadastral.properties.correction_lng) || 0) !== 0 || (Number(content.cadastral.properties.correction_lat) || 0) !== 0),
  )
  const referenceLatitude = content.cadastral?.center?.[1] ?? -12.046374
  const eastMeters = adjustmentDelta.lng * 111_320 * Math.cos(referenceLatitude * Math.PI / 180)
  const northMeters = adjustmentDelta.lat * 111_320
  const movedMeters = Math.hypot(eastMeters, northMeters)
  const detailPoint = content.detail?.geometry?.type === "Point" ? content.detail.geometry.coordinates : null
  const detailLng = typeof detailPoint?.[0] === "number" ? detailPoint[0] : null
  const detailLat = typeof detailPoint?.[1] === "number" ? detailPoint[1] : null
  const detailCoordinates = coordinatesText(detailLng, detailLat)
  const cadastralLink = content.detail?.cadastralLink ?? null
  const structuredCadastre = content.detail?.cadastre ?? null
  const structuredDistrict = structuredCadastre?.districtName
    ? `${structuredCadastre.districtCode ?? ""} · ${structuredCadastre.districtName}`.replace(/^ · /, "")
    : structuredCadastre?.districtCode
  const cuaValue = structuredCadastre?.cuaLabel
    ? `${structuredCadastre.cuaCode ? `${structuredCadastre.cuaCode} · ` : ""}${structuredCadastre.cuaLabel}`
    : null
  const copyCoordinates = (): void => {
    if (!detailCoordinates) return
    void navigator.clipboard.writeText(detailCoordinates).then(() => {
      setCopiedCoordinates(true)
      window.setTimeout(() => setCopiedCoordinates(false), 1800)
    }).catch(() => setCopiedCoordinates(false))
  }

  return (
    <Panel
      aria-label="Inspector de suministro"
      as="aside"
      className={`absolute inset-x-3 bottom-3 max-h-[60vh] translate-y-0 overflow-y-auto opacity-100 transition-[transform,opacity] duration-300 ease-[var(--ease-out-soft)] starting:translate-y-full starting:opacity-0 md:inset-y-3 md:inset-x-auto md:right-3 md:max-h-[calc(100%-1.5rem)] md:w-[23rem] md:translate-x-0 md:translate-y-0 md:starting:translate-x-full md:starting:translate-y-0 ${
        open ? "" : "translate-y-full opacity-0 md:translate-x-full md:translate-y-0"
      }`}
      elevation="raised"
    >
      <header className="panel-sheen sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface-1/95 px-4 py-3 backdrop-blur-xl">
        <div className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-brand/35 bg-brand-dim text-brand">
          <MapPin aria-hidden="true" size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            {content.detail ? "Suministro" : "Ficha técnica"}
          </p>
          <h2 className="truncate font-semibold text-fg">
            {content.detail?.supply.code || cadastralCode || (content.relation ? "Ubicación consultada" : "Cargando…")}
          </h2>
        </div>
        <IconButton
          icon={<X aria-hidden="true" size={18} strokeWidth={1.75} />}
          label="Cerrar inspector"
          onClick={onClose}
          variant="ghost"
        />
      </header>

      {content.loading ? (
        <div aria-busy="true" className="space-y-3 p-4">
          {[1, 2, 3, 4].map((item) => (
            <div className="h-14 animate-pulse rounded-[var(--radius-control)] bg-surface-3" key={item} />
          ))}
        </div>
      ) : content.cadastral ? (
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                {content.cadastral.kind === "lot" ? "Lote catastral" : "Manzana catastral"}
              </p>
              <p className="mt-1 text-sm text-fg-muted">Geometría oficial de Catastro Comercial SEDAPAL.</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge>Distrito {propertyText(content.cadastral.properties, "district_code") ?? "—"}</Badge>
              <MapsActions lat={content.cadastral.center?.[1]} lng={content.cadastral.center?.[0]} onError={onError} />
            </div>
          </div>

          {adjustmentMode ? (
            <div className="rounded-[var(--radius-control)] border border-brand/35 bg-brand-dim p-3">
              <p className="text-sm font-semibold text-fg">Arrastra el contorno resaltado para alinearlo.</p>
              <p className="mt-1 text-xs text-fg-muted">
                Desplazamiento: <strong className="text-brand">{movedMeters.toFixed(2)} m</strong> (
                {eastMeters >= 0 ? "este" : "oeste"} {Math.abs(eastMeters).toFixed(2)} m,{" "}
                {northMeters >= 0 ? "norte" : "sur"} {Math.abs(northMeters).toFixed(2)} m)
              </p>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2">
                <span className="text-xs font-medium text-fg-muted">Ajuste fino de 0.5 m</span>
                <div className="grid grid-cols-3 gap-1">
                  <span />
                  <IconButton
                    icon={<ArrowUp size={15} strokeWidth={1.75} />}
                    label="Mover 0.5 metros al norte"
                    onClick={() => onAdjustmentNudge(0, 0.5)}
                    size="sm"
                  />
                  <span />
                  <IconButton
                    icon={<ArrowLeft size={15} strokeWidth={1.75} />}
                    label="Mover 0.5 metros al oeste"
                    onClick={() => onAdjustmentNudge(-0.5, 0)}
                    size="sm"
                  />
                  <IconButton
                    icon={<ArrowDown size={15} strokeWidth={1.75} />}
                    label="Mover 0.5 metros al sur"
                    onClick={() => onAdjustmentNudge(0, -0.5)}
                    size="sm"
                  />
                  <IconButton
                    icon={<ArrowRight size={15} strokeWidth={1.75} />}
                    label="Mover 0.5 metros al este"
                    onClick={() => onAdjustmentNudge(0.5, 0)}
                    size="sm"
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={adjustmentSaving || (!adjustmentDelta.lng && !adjustmentDelta.lat)}
                  onClick={onAdjustmentSave}
                  variant="primary"
                >
                  <Save size={15} strokeWidth={1.75} />
                  {adjustmentSaving ? "Guardando…" : "Aplicar posición"}
                </Button>
                <Button disabled={adjustmentSaving} onClick={onAdjustmentCancel}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button className="flex-1" onClick={() => onAdjustmentStart("selection")}>
                <Move size={15} strokeWidth={1.75} />
                {content.cadastral.kind === "lot" ? "Mover solo lote" : "Mover manzana completa"}
              </Button>
              {content.cadastral.kind === "lot" ? (
                <Button className="flex-1" onClick={() => onAdjustmentStart("block")} variant="accent">
                  <Move size={15} strokeWidth={1.75} />
                  Mover manzana completa
                </Button>
              ) : null}
              {hasCorrection ? (
                <IconButton
                  disabled={adjustmentSaving}
                  icon={<RotateCcw size={15} strokeWidth={1.75} />}
                  label="Restablecer posición oficial"
                  onClick={onAdjustmentReset}
                />
              ) : null}
            </div>
          )}

          {adjustmentNotice ? (
            <p className="rounded-[var(--radius-control)] border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">
              {adjustmentNotice}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-2">
            <Value label="Distrito" value={propertyText(content.cadastral.properties, "district")} />
            <Value label="Manzana" value={propertyText(content.cadastral.properties, "block_code")} />
            {content.cadastral.kind === "lot" ? <Value label="ID del lote" value={propertyText(content.cadastral.properties, "lot_code")} /> : null}
            {content.cadastral.kind === "lot" ? <Value label="Código de predio (CUPCODE)" value={propertyText(content.cadastral.properties, "cup_code")} /> : null}
            <Value label="Código predial" value={propertyText(content.cadastral.properties, "property_code")} />
            <Value
              label="Tipo"
              value={(() => {
                const code = propertyText(content.cadastral.properties, content.cadastral.kind === "lot" ? "lot_type_code" : "block_type_code")
                return code ? `${lotTypeLabels[code] ?? code} · ${code}` : null
              })()}
            />
            {content.cadastral.kind === "lot" ? <Value label="Estado" value={propertyText(content.cadastral.properties, "project_status")} /> : null}
            {content.cadastral.kind === "lot" ? <Value label="Niveles" value={propertyText(content.cadastral.properties, "levels")} /> : null}
            <Value label="Área" value={measurementText(content.cadastral.properties, "area_m2", "m²")} />
            <Value label="Perímetro" value={measurementText(content.cadastral.properties, "perimeter_m", "m")} />
            {content.cadastral.kind === "block" ? <Value label="Cantidad de lotes" value={propertyText(content.cadastral.properties, "lot_count")} /> : null}
          </dl>
        </div>
      ) : content.detail ? (
        <div className="space-y-5 p-4">
          {structuredCadastre ? (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <LandPlot aria-hidden="true" size={16} strokeWidth={1.75} /> Catastro comercial
                </h3>
                {structuredCadastre.cupCode ? <Badge>Código de predio</Badge> : null}
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <Value label="Distrito" value={structuredDistrict} />
                <Value label="Manzana" value={structuredCadastre.blockCode} />
                <Value label="Código de predio (CUPCODE)" value={structuredCadastre.cupCode} />
                <Value label="CUA" value={cuaValue} />
              </dl>
              {structuredCadastre.districtMatchStatus === "SOURCE_MISMATCH" ? (
                <p className="mt-2 rounded-[var(--radius-control)] border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">
                  El distrito informado difiere del prefijo del CUPCODE; se conserva la observación para revisión.
                </p>
              ) : null}
              {structuredCadastre.cuaMatchMethod === "UNRESOLVED" ? (
                <p className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2 text-xs text-fg-muted">
                  El uso de agua se conserva como texto porque no tiene una coincidencia única en el catálogo.
                </p>
              ) : null}
              {cadastralLink ? (
                <Button className="mt-2 w-full" onClick={() => onViewCadastralLink(cadastralLink)} variant="outline">
                  <LandPlot aria-hidden="true" size={15} strokeWidth={1.75} />
                  Ver predio {cadastralLink.code ?? ""} en el mapa
                </Button>
              ) : null}
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <MapPin aria-hidden="true" size={16} strokeWidth={1.75} /> Ubicación
              </h3>
              <div className="flex items-center gap-1.5">
                {copiedCoordinates ? <span className="text-[11px] font-medium text-brand">Copiadas</span> : null}
                <IconButton
                  disabled={!detailCoordinates}
                  icon={<Copy aria-hidden="true" size={14} strokeWidth={1.75} />}
                  label="Copiar coordenadas"
                  onClick={copyCoordinates}
                  size="sm"
                />
                <MapsActions
                  lat={detailLat}
                  lng={detailLng}
                  onError={onError}
                  onOpenReport={onOpenReport}
                  supplyCode={content.detail.supply.code}
                />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {!structuredCadastre ? <Value label="Distrito" value={content.detail.hierarchy.district} /> : null}
              {!structuredCadastre ? <Value label="Lote" value={content.detail.hierarchy.lot} /> : null}
              <Value label="Coordenadas" value={detailCoordinates} />
              <div className="col-span-2"><Value label="Dirección" value={content.detail.supply.address} /></div>
            </dl>
            {content.detail.hierarchy.provisional && !structuredCadastre ? (
              <p className="mt-2 text-xs text-warning">
                Sector y lote corresponden a referencias textuales; aún no tienen geometría oficial.
              </p>
            ) : null}
            {cadastralLink && !structuredCadastre ? (
              <Button className="mt-2 w-full" onClick={() => onViewCadastralLink(cadastralLink)} variant="outline">
                <LandPlot aria-hidden="true" size={15} strokeWidth={1.75} />
                Ver predio {cadastralLink.code ?? ""} en el catastro
              </Button>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
              <Gauge aria-hidden="true" size={16} strokeWidth={1.75} /> Suministro y medidor
            </h3>
            <dl className="grid grid-cols-2 gap-2">
              <Value label="Cliente" value={content.detail.supply.customerName} />
              <Value label="Estado" value={content.detail.supply.status} />
              <Value label="Medidor" value={content.detail.meter?.code} />
              <Value label="Instalación" value={content.detail.meter?.installationDate} />
              <Value label="Estado medidor" value={content.detail.meter?.status} />
            </dl>
          </section>

          <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2 text-xs text-fg-muted">
            <Ruler aria-hidden="true" size={15} strokeWidth={1.75} /> Estas coordenadas son referenciales, no una medición topográfica exacta.
          </div>
        </div>
      ) : content.relation ? (
        <div className="space-y-4 p-4">
          <p className="text-sm text-fg-muted">Relación espacial encontrada para el punto seleccionado.</p>
          <dl className="grid grid-cols-2 gap-2">
            <Value label="Distrito" value={content.relation.district?.name} />
            <Value label="Manzana" value={content.relation.block?.blockCode} />
            <Value label="Lote" value={content.relation.lot?.lotCode} />
            <Value label="Código predial" value={content.relation.lot?.propertyCode} />
            <Value label="Área del lote" value={content.relation.lot?.areaM2 ? `${content.relation.lot.areaM2.toLocaleString("es-PE", { maximumFractionDigits: 2 })} m²` : null} />
            <Value label="Perímetro" value={content.relation.lot?.perimeterM ? `${content.relation.lot.perimeterM.toLocaleString("es-PE", { maximumFractionDigits: 2 })} m` : null} />
            <Value label="Suministro cercano" value={content.relation.supply?.supplyCode} />
          </dl>
          {!content.relation.supply ? (
            <p className="rounded-[var(--radius-control)] border border-line bg-surface-2/70 px-3 py-2 text-xs text-fg-muted">
              No hay un suministro a menos de 25 metros.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
