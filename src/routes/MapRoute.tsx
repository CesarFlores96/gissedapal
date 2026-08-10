import { RefreshCw, TriangleAlert } from "lucide-react"
import { useNavigate } from "react-router"

import { InspectorDrawer } from "../components/InspectorDrawer"
import { LayerPanel } from "../components/LayerPanel"
import { IconButton, Panel } from "../components/ui"
import { useMapData } from "../features/map/mapDataContext"
import { useSelection } from "../features/selection/selectionContext"

/**
 * La ruta del mapa no renderiza `MapView`: esa capa la mantiene montada el
 * shell. Aquí solo viven los paneles que se superponen a ella, que se ordenan
 * por orden del DOM dentro del `isolate` de <main> en vez de con z-index.
 *
 * `pointer-events-auto` en cada panel reactiva los clics que el contenedor de
 * ruta desactiva para dejar pasar la interacción al mapa.
 */
export function MapRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const { activeLayers, layerMeta, loading, mapError, reloadLastView, setMapError, toggleLayer } = useMapData()
  const selection = useSelection()

  return (
    <>
      <div className="pointer-events-auto">
        <LayerPanel
          activeLayers={activeLayers}
          layerMeta={layerMeta}
          loading={loading}
          onToggle={toggleLayer}
        />
      </div>

      <div className="pointer-events-auto">
        <InspectorDrawer
          adjustmentDelta={selection.adjustmentDelta}
          adjustmentMode={selection.adjustmentMode}
          adjustmentNotice={selection.adjustmentNotice}
          adjustmentSaving={selection.adjustmentSaving}
          cadastral={selection.cadastralSelection}
          detail={selection.selectedSupply}
          loading={selection.inspectorLoading}
          onAdjustmentCancel={selection.cancelAdjustment}
          onAdjustmentNudge={selection.nudgeAdjustment}
          onAdjustmentReset={() => { void selection.persistAdjustment(true) }}
          onAdjustmentSave={() => { void selection.persistAdjustment(false) }}
          onAdjustmentStart={(target) => { void selection.startAdjustment(target) }}
          onClose={selection.clearSelection}
          onError={setMapError}
          onOpenReport={(supplyCode) => { void navigate(`/suministro/${encodeURIComponent(supplyCode)}`) }}
          onViewCadastralLink={(link) => { void selection.viewSupplyCadastre(link) }}
          relation={selection.resolvedLocation}
        />
      </div>

      {mapError ? (
        <Panel
          className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 border-danger/35 px-3 py-2 text-sm text-danger"
          elevation="raised"
          role="alert"
        >
          <TriangleAlert aria-hidden="true" size={17} strokeWidth={1.75} />
          <span className="truncate">{mapError}</span>
          <IconButton
            className="ml-1"
            icon={<RefreshCw aria-hidden="true" size={15} strokeWidth={1.75} />}
            label="Reintentar carga"
            onClick={reloadLastView}
            size="sm"
            variant="ghost"
          />
        </Panel>
      ) : null}
    </>
  )
}
