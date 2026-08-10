import { lazy } from "react"

import { useSelection } from "../selection/selectionContext"
import { useMapData } from "./mapDataContext"

const MapView = lazy(() => import("../../components/MapView").then((module) => ({ default: module.MapView })))

/**
 * Único punto donde se conecta `MapView` con los dos providers. Cada uno expone
 * su paquete de props ya memoizado para no anular el `memo()` de MapView, que
 * es lo que evita re-renderizar un componente de ~870 líneas en cada tecleo.
 */
export function MapSlot(): React.JSX.Element {
  const { mapViewProps: dataProps } = useMapData()
  const { mapViewProps: selectionProps } = useSelection()

  return <MapView {...dataProps} {...selectionProps} />
}
