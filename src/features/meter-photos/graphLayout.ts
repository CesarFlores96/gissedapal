/**
 * Layout del grafo de incidencias con d3-force, **headless y determinista**.
 *
 * Sin `requestAnimationFrame` ni ticker: se corre un número fijo de ticks y se
 * devuelven coordenadas. Dos motivos:
 *
 * - Se puede probar en jsdom, porque d3-force es matemática pura sin DOM.
 * - Dos corridas con los mismos datos dan la misma imagen, así que el grafo no
 *   "salta" al re-renderizar y el test de determinismo dice algo real.
 *
 * Las posiciones iniciales se siembran en un círculo explícito en vez de
 * confiar en el filotaxis interno de d3: hace la reproducibilidad una propiedad
 * de este archivo y no un detalle de implementación de la librería.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force"

import { maxPhotoCount, nodeRadius } from "./incidenceGraph"
import type { IncidenceGraph, IncidenceNode } from "./types"

export type LaidOutNode = {
  id: string
  x: number
  y: number
  radius: number
  photoCount: number
  source: IncidenceNode["source"]
}

export type LaidOutEdge = {
  source: string
  target: string
  weight: number
}

export type GraphLayout = {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
}

type SimNode = SimulationNodeDatum & {
  id: string
  radius: number
  photoCount: number
  source: IncidenceNode["source"]
}

type SimLink = SimulationLinkDatum<SimNode> & { weight: number }

const TICKS = 300

export function computeLayout(
  graph: IncidenceGraph,
  width: number,
  height: number,
): GraphLayout {
  if (graph.nodes.length === 0) return { nodes: [], edges: [] }

  const maxCount = maxPhotoCount(graph.nodes)
  const centerX = width / 2
  const centerY = height / 2
  const seedRadius = Math.min(width, height) / 3

  const simNodes: SimNode[] = graph.nodes.map((node, index) => {
    const angle = (index / graph.nodes.length) * Math.PI * 2
    return {
      id: node.incidence,
      radius: nodeRadius(node.photo_count, maxCount),
      photoCount: node.photo_count,
      source: node.source,
      x: centerX + Math.cos(angle) * seedRadius,
      y: centerY + Math.sin(angle) * seedRadius,
    }
  })

  const known = new Set(simNodes.map((node) => node.id))
  const simLinks: SimLink[] = graph.edges
    .filter((edge) => known.has(edge.source_incidence) && known.has(edge.target_incidence))
    .map((edge) => ({
      source: edge.source_incidence,
      target: edge.target_incidence,
      weight: edge.weight,
    }))

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => 140 - Math.min(link.weight, 10) * 6)
        .strength(0.25),
    )
    .force("charge", forceManyBody().strength(-420))
    .force("center", forceCenter(centerX, centerY))
    // El radio de colisión usa el radio real del nodo: sin esto los nodos
    // grandes se solapan y sus etiquetas quedan ilegibles.
    .force(
      "collide",
      forceCollide<SimNode>().radius((node) => node.radius + 14),
    )
    .stop()

  for (let tick = 0; tick < TICKS; tick += 1) {
    simulation.tick()
  }

  return {
    nodes: simNodes.map((node) => ({
      id: node.id,
      // `?? centerX` cubre el caso degenerado de un NaN: un nodo perdido en el
      // infinito rompe el encuadre de todo el canvas.
      x: Number.isFinite(node.x) ? (node.x as number) : centerX,
      y: Number.isFinite(node.y) ? (node.y as number) : centerY,
      radius: node.radius,
      photoCount: node.photoCount,
      source: node.source,
    })),
    edges: simLinks.map((link) => ({
      source: typeof link.source === "object" ? (link.source as SimNode).id : String(link.source),
      target: typeof link.target === "object" ? (link.target as SimNode).id : String(link.target),
      weight: link.weight,
    })),
  }
}

/** Encuadre que mete todos los nodos en el viewport, con margen. */
export function fitTransform(
  layout: GraphLayout,
  width: number,
  height: number,
): { k: number; x: number; y: number } {
  if (layout.nodes.length === 0) return { k: 1, x: 0, y: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of layout.nodes) {
    minX = Math.min(minX, node.x - node.radius)
    minY = Math.min(minY, node.y - node.radius)
    maxX = Math.max(maxX, node.x + node.radius)
    maxY = Math.max(maxY, node.y + node.radius)
  }

  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const margin = 48
  const k = Math.min((width - margin) / spanX, (height - margin) / spanY, 2)
  const safeK = Number.isFinite(k) && k > 0 ? k : 1

  return {
    k: safeK,
    x: width / 2 - ((minX + maxX) / 2) * safeK,
    y: height / 2 - ((minY + maxY) / 2) * safeK,
  }
}
