import { createContext, use } from "react"

import type { SessionSnapshot, SessionUser } from "../../types"

export function isReadOnlyUser(user: SessionUser | null | undefined): boolean {
  if (!user) return false
  if (user.isReadOnly) return true
  const isMyf = (s: string): boolean => {
    const lower = s.trim().toLowerCase()
    return lower === "myfsedapal" || lower.startsWith("myfsedapal@")
  }
  if (user.email && isMyf(user.email)) return true
  if (user.username && isMyf(user.username)) return true
  if (user.role) {
    const roleLower = user.role.trim().toLowerCase()
    if (["read_only", "readonly", "consulta", "visualizador"].includes(roleLower)) return true
  }
  return false
}

export type SessionValue = {
  session: SessionSnapshot | null
  isReadOnly: boolean
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
