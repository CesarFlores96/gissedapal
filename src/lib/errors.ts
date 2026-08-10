const DEFAULT_FALLBACK = "No se pudo completar la operación."

export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  if (typeof reason === "string" && reason.trim()) return reason
  if (reason && typeof reason === "object" && "message" in reason) {
    const message = (reason as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message
  }
  return fallback
}

/** Mensaje listo para mostrar al usuario, con el texto genérico por defecto. */
export function friendlyError(reason: unknown): string {
  return errorMessage(reason, DEFAULT_FALLBACK)
}

/**
 * La sesión caducó o el backend rechazó el token. Se distingue del resto de
 * errores porque obliga a volver al login en vez de mostrar un aviso en la vista.
 */
export function isExpiredSession(reason: unknown): boolean {
  return Boolean(reason && typeof reason === "object" && "code" in reason && reason.code === "unauthorized")
}
