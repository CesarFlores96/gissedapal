import type { BuildingFacade } from "../../types"
import { type FacadePlacement, toMercator } from "./facadePlacement"

/** Un vértice de la envolvente en el marco local de la fachada (metros:
 * `x` a lo largo del frente, `z` hacia la calle) con la coordenada horizontal
 * de la foto que le toca. */
export type WrapPoint = { x: number; z: number; u: number }

export type FacadeWrap = {
  points: WrapPoint[]
  /** Posición local de la cámara: define qué lado de cada tramo es "afuera". */
  camera: [number, number]
}

/** En la esquina, cada tramo se parte cada ~1 m para que la foto siga la
 * proyección de la cámara y no una interpolación lineal entre esquinas. */
const MAX_SUBDIVISION_M = 1

const sameVertex = (a: [number, number], b: [number, number]): boolean => (
  Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7
)

/**
 * Polilínea sobre la que se reparte la foto: `gis.wrapEdge` (frente + caras
 * de esquina que dan a la calle) o, si no viene, solo el frente.
 *
 * La foto va de izquierda a derecha de la imagen, y la posición horizontal de
 * un punto en la imagen es proporcional a `tan(ángulo respecto del heading)`.
 * Normalizar esa tangente entre los extremos de la envolvente da su `u` sin
 * conocer el campo de visión de la captura (la escala se cancela): se asume
 * que el contorno que marcó Gemma empieza y termina donde la envolvente.
 */
export function computeFacadeWrap(facade: BuildingFacade, placement: FacadePlacement): FacadeWrap | null {
  const front = facade.gis.frontEdge
  const wrapEdge = facade.gis.wrapEdge
  const coversFront = Boolean(
    wrapEdge && wrapEdge.length >= 2 && front.length >= 2
    && wrapEdge.some((p) => sameVertex(p, front[0]))
    && wrapEdge.some((p) => sameVertex(p, front[front.length - 1])),
  )
  const line = coversFront ? wrapEdge! : front.length >= 2 ? [front[0], front[front.length - 1]] : null
  if (!line) return null

  const { origin, right, depth } = placement
  const rightSq = right[0] ** 2 + right[1] ** 2
  const depthSq = depth[0] ** 2 + depth[1] ** 2
  if (rightSq <= 0 || depthSq <= 0) return null
  const toLocal = (lng: number, lat: number): [number, number] => {
    const [mx, my] = toMercator(lng, lat)
    const dx = mx - origin[0]
    const dy = my - origin[1]
    return [(dx * right[0] + dy * right[1]) / rightSq, (dx * depth[0] + dy * depth[1]) / depthSq]
  }

  const { lat: camLat, lng: camLng, heading } = facade.source
  const cosLat = Math.cos((camLat * Math.PI) / 180)
  const headingRad = ((heading ?? 0) * Math.PI) / 180
  const viewTan = (lng: number, lat: number): number | null => {
    const dx = (lng - camLng) * cosLat
    const dy = lat - camLat
    const ahead = dx * Math.sin(headingRad) + dy * Math.cos(headingRad)
    const side = dx * Math.cos(headingRad) - dy * Math.sin(headingRad)
    return ahead > 1e-9 ? side / ahead : null
  }

  // Subdivisión en lng/lat: a escala de un lote es lineal en metros.
  const samples: { lngLat: [number, number]; local: [number, number] }[] = []
  for (let i = 0; i < line.length; i += 1) {
    const local = toLocal(line[i][0], line[i][1])
    if (i > 0 && line.length > 2) {
      const prev = samples[samples.length - 1]
      const pieces = Math.max(1, Math.ceil(Math.hypot(local[0] - prev.local[0], local[1] - prev.local[1]) / MAX_SUBDIVISION_M))
      for (let k = 1; k < pieces; k += 1) {
        const t = k / pieces
        const lngLat: [number, number] = [
          line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
          line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
        ]
        samples.push({ lngLat, local: toLocal(lngLat[0], lngLat[1]) })
      }
    }
    samples.push({ lngLat: [line[i][0], line[i][1]], local })
  }

  const tans = heading === null ? null : samples.map(({ lngLat }) => viewTan(lngLat[0], lngLat[1]))
  let us: number[]
  if (tans && tans.every((t): t is number => t !== null) && Math.abs(tans[tans.length - 1] - tans[0]) > 1e-6) {
    if (tans[tans.length - 1] < tans[0]) {
      samples.reverse()
      tans.reverse()
    }
    const t0 = tans[0]
    const span = tans[tans.length - 1] - t0
    let previous = 0
    // Monótona: una cara oculta no puede "volver" sobre la foto.
    us = tans.map((t) => (previous = Math.max(previous, Math.min(1, Math.max(0, (t - t0) / span)))))
  } else {
    // Sin heading no hay proyección: reparto por longitud, en el sentido del frente.
    if (samples[samples.length - 1].local[0] < samples[0].local[0]) samples.reverse()
    const lengths = [0]
    for (let i = 1; i < samples.length; i += 1) {
      const [ax, az] = samples[i - 1].local
      const [bx, bz] = samples[i].local
      lengths.push(lengths[i - 1] + Math.hypot(bx - ax, bz - az))
    }
    const total = lengths[lengths.length - 1]
    if (total <= 0) return null
    us = lengths.map((length) => length / total)
  }

  const camera = toLocal(camLng, camLat)
  return {
    points: samples.map(({ local }, i) => ({ x: local[0], z: local[1], u: us[i] })),
    camera,
  }
}
