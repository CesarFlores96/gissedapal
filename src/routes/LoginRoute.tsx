import { Navigate, useLocation } from "react-router"

import { LoginPage } from "../components/LoginPage"
import { useSession } from "../app/session/sessionContext"

type LocationState = { from?: { pathname?: string } }

export function LoginRoute(): React.JSX.Element {
  const { session, authError, login } = useSession()
  const location = useLocation()

  if (session?.authenticated) {
    const from = (location.state as LocationState | null)?.from?.pathname
    return <Navigate replace to={from ?? "/mapa"} />
  }

  return <LoginPage error={authError} onLogin={login} />
}
