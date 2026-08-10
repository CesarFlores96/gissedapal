import { useEffect, useRef, useState } from "react"

/**
 * Mantiene un nodo montado `delayMs` después de que `active` pasa a false, para
 * que la transición de salida tenga tiempo de reproducirse antes de desmontar.
 *
 * El "true" inmediato se resuelve ajustando el estado durante el render (el
 * patrón que React documenta para esto, sin pasar por un efecto); el "false"
 * demorado solo se aplica dentro del callback de un setTimeout, nunca de forma
 * síncrona en el cuerpo del efecto.
 */
export function useDelayedUnmount(active: boolean, delayMs: number): boolean {
  const [mounted, setMounted] = useState(active)
  const timeoutRef = useRef<number | null>(null)

  if (active && !mounted) setMounted(true)

  useEffect(() => {
    if (active) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }
    timeoutRef.current = window.setTimeout(() => {
      setMounted(false)
      timeoutRef.current = null
    }, delayMs)
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [active, delayMs])

  return mounted
}
