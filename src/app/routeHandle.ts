import type { ReactNode } from "react"

/**
 * Metadatos que cada ruta cuelga de `handle` y que el shell lee con
 * `useMatches()`. `header` permite que una ruta se apropie de la fila de
 * cabecera sin cambiar su altura; `showsMap` deja visible la capa persistente
 * del mapa y `dedicatedMap` la desmonta cuando una ruta usa su propio canvas.
 */
export type RouteHandle = {
  title?: string
  header?: () => ReactNode
  showsMap?: boolean
  dedicatedMap?: boolean
}
