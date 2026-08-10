import type { ReactNode } from "react"

/**
 * Metadatos que cada ruta cuelga de `handle` y que el shell lee con
 * `useMatches()`. `header` permite que una ruta se apropie de la fila de
 * cabecera sin cambiar su altura; `showsMap` marca la única ruta que deja
 * visible la capa persistente del mapa.
 */
export type RouteHandle = {
  title?: string
  header?: () => ReactNode
  showsMap?: boolean
}
