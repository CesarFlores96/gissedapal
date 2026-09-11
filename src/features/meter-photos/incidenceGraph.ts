/**
 * Lógica pura del grafo de incidencias: escalas, colores y búsqueda.
 *
 * Deliberadamente separado de `IncidenceGraphCanvas.tsx`: en jsdom
 * `getContext("2d")` devuelve `null`, así que el componente de dibujo no se
 * puede probar. Todo lo que sí merece prueba vive acá y en `graphLayout.ts`.
 */

import type { IncidenceGraph, IncidenceNode } from "./types"

const MIN_NODE_RADIUS = 10
const MAX_NODE_RADIUS = 46

/**
 * Radio proporcional a la **raíz** del conteo, es decir proporcional al área.
 * Con radio lineal, una incidencia con 400 fotos se dibuja 400 veces más ancha
 * que una con 1 y tapa el resto del grafo.
 */
export function nodeRadius(photoCount: number, maxPhotoCount: number): number {
  if (photoCount <= 0 || maxPhotoCount <= 0) return MIN_NODE_RADIUS
  const ratio = Math.sqrt(photoCount) / Math.sqrt(maxPhotoCount)
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS)
}

export type GraphSearchTarget = {
  incidence: string
  fileNames?: string[]
  lecturas?: string[]
  numerosMedidor?: string[]
}

function fold(value: string): string {
  // Sin regex de rango: los diacriticos combinantes escritos literalmente en el
  // fuente son fragiles frente a herramientas que reescriben el archivo.
  // NFD separa la tilde en un caracter combinante propio (U+0300..U+036F) y
  // aca se descarta por punto de codigo.
  let folded = ""
  for (const char of value.normalize("NFD")) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x0300 && code <= 0x036f) continue
    folded += char
  }
  return folded.toLowerCase().trim()
}

/**
 * ¿Este nodo coincide con la búsqueda? Se busca por incidencia, archivo,
 * lectura y número de medidor, sin distinguir tildes ni mayúsculas.
 */
export function matchesSearch(target: GraphSearchTarget, query: string): boolean {
  const needle = fold(query)
  if (!needle) return true
  const haystacks = [
    target.incidence,
    ...(target.fileNames ?? []),
    ...(target.lecturas ?? []),
    ...(target.numerosMedidor ?? []),
  ]
  return haystacks.some((value) => fold(value).includes(needle))
}

/** Nodos que quedan tras aplicar la búsqueda, más las aristas cuyos dos
 *  extremos sobreviven (una arista colgando de un solo nodo no se dibuja). */
export function filterGraph(graph: IncidenceGraph, query: string): IncidenceGraph {
  if (!query.trim()) return graph
  const nodes = graph.nodes.filter((node) => matchesSearch({ incidence: node.incidence }, query))
  const names = new Set(nodes.map((node) => node.incidence))
  const edges = graph.edges.filter(
    (edge) => names.has(edge.source_incidence) && names.has(edge.target_incidence),
  )
  return { nodes, edges, totalPhotos: graph.totalPhotos }
}

export function maxPhotoCount(nodes: IncidenceNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.photo_count), 0)
}
