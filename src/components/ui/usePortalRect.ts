import { useLayoutEffect, useState, type RefObject } from "react"

/**
 * Mide la posición de `anchorRef` en coordenadas de viewport mientras `open`
 * es true, para poder portar un menú a `document.body` con `position: fixed`.
 *
 * Sin portal, un desplegable absolutamente posicionado queda contenido por
 * cualquier ancestro con `overflow` distinto de `visible` (como la barra de
 * herramientas, que necesita `overflow-x-auto` para no desbordar en ventanas
 * angostas) — eso es lo que lo recortaba dentro del appbar.
 */
export function usePortalRect(open: boolean, anchorRef: RefObject<HTMLElement | null>): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const update = (): void => setRect(anchorRef.current?.getBoundingClientRect() ?? null)
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [anchorRef, open])

  return open ? rect : null
}
