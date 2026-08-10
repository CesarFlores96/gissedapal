import { createContext, use } from "react"

import type { SessionSnapshot } from "../../types"

export type SessionValue = {
  session: SessionSnapshot | null
  bootStatus: string
  authError: string | null
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /**
   * Centraliza el tratamiento de la sesión caducada, que antes se repetía en
   * ocho `catch` distintos. Devuelve true si el error era de sesión expirada y
   * ya se cerró la sesión; en ese caso quien llama no debe mostrar nada más,
   * porque la redirección al login lo sustituye.
   */
  reportError: (reason: unknown) => boolean
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = use(SessionContext)
  if (!value) throw new Error("useSession debe usarse dentro de <SessionProvider>.")
  return value
}
