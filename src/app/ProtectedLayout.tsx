import { Navigate, useLocation } from "react-router"

import { MapDataProvider } from "../features/map/MapDataProvider"
import { SelectionProvider } from "../features/selection/SelectionProvider"
import { useSession } from "./session/sessionContext"
import { AppShell } from "./shell/AppShell"
import { SplashScreen } from "./shell/SplashScreen"

/**
 * Gate de sesión. Sustituye a los `return` tempranos que antes vivían en App:
 * al ser una ruta, los ocho sitios que cierran la sesión al recibir un 401
 * redirigen solos en cuanto `session` cambia.
 *
 * Los providers de datos cuelgan de aquí y no de la raíz para que su estado se
 * descarte al cerrar sesión, sin necesidad de limpiarlo a mano.
 */
export function ProtectedLayout(): React.JSX.Element {
  const { session, bootStatus } = useSession()
  const location = useLocation()

  if (session === null) {
    return <SplashScreen status={bootStatus} />
  }

  if (!session.authenticated) {
    return <Navigate replace state={{ from: location }} to="/login" />
  }

  return (
    <MapDataProvider>
      <SelectionProvider>
        <AppShell />
      </SelectionProvider>
    </MapDataProvider>
  )
}
