import maplibregl from "maplibre-gl"

import type { BuildingFacade } from "../../types"

export type Vec3 = [number, number, number]

/** Los 3 ejes locales de una fachada, expresados en unidades Mercator "por
 * metro real" -- multiplicar por metros da el desplazamiento Mercator
 * correcto para esa dirección, en ese punto del mundo. */
export type FacadePlacement = {
  /** Origen (esquina de `front_edge_start`, a nivel de suelo) en coordenadas Mercator. */
  origin: Vec3
  /** A lo largo de la fachada, de `front_edge_start` hacia `front_edge_end`
   * tal como se ve desde la cámara de Street View (izquierda -> derecha de
   * la imagen), por metro real. */
  right: Vec3
  /** Vertical (altura), por metro real. */
  up: Vec3
  /** Perpendicular al muro, apuntando hacia la calle/cámara (positivo =
   * sobresale hacia el espectador), por metro real. */
  depth: Vec3
}

function toMercator(lng: number, lat: number): Vec3 {
  const coord = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0)
  return [coord.x, coord.y, coord.z]
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor]
}

/**
 * Deriva el sistema de coordenadas local de una fachada a partir de su
 * `front_edge` real (GIS) y la posición de la cámara que la analizó.
 *
 * No depende de qué extremo del polígono catastral haya quedado como
 * `front_edge_start`/`end`: orienta `right` para que coincida con
 * izquierda->derecha tal como la vio la cámara (usando el heading), así el
 * contorno/elementos normalizados de Gemma (que están en coordenadas de
 * imagen) quedan del lado correcto sin necesidad de que el backend adivine
 * el orden.
 */
export function computeFacadePlacement(facade: BuildingFacade): FacadePlacement | null {
  const [start, end] = facade.gis.frontEdge
  if (!start || !end || facade.gis.frontWidthM <= 0) return null

  const startMerc = toMercator(start[0], start[1])
  const endMerc = toMercator(end[0], end[1])
  const edgeMerc = subtract(endMerc, startMerc)

  const widthM = facade.gis.frontWidthM
  let rightPerMeter: Vec3 = scale(edgeMerc, 1 / widthM)

  // Perpendicular horizontal (rotar 90° en el plano x,y de Mercator). La
  // magnitud es igual a la de `right` porque Mercator es localmente
  // conforme (misma escala en x e y en un punto dado).
  let depthPerMeter: Vec3 = [-rightPerMeter[1], rightPerMeter[0], 0]

  const cameraMerc = toMercator(facade.source.lng, facade.source.lat)
  const midpointMerc: Vec3 = [
    (startMerc[0] + endMerc[0]) / 2,
    (startMerc[1] + endMerc[1]) / 2,
    (startMerc[2] + endMerc[2]) / 2,
  ]
  const towardCamera = subtract(cameraMerc, midpointMerc)
  const facesCamera = depthPerMeter[0] * towardCamera[0] + depthPerMeter[1] * towardCamera[1]
  if (facesCamera < 0) depthPerMeter = scale(depthPerMeter, -1)

  // Orientar `right` para que sea izquierda->derecha vistO DESDE LA CAMARA
  // (heading conocido): el lado derecho de un observador que mira en
  // direccion `heading` es `(cos(heading), -sin(heading))` en ENU
  // (x=este,y=norte). Sin heading no hay forma de saber el sentido, así que
  // se conserva el orden que ya trae `front_edge` (mejor que adivinar).
  const heading = facade.source.heading
  if (heading !== null) {
    const headingRad = (heading * Math.PI) / 180
    const cameraRightEnu: [number, number] = [Math.cos(headingRad), -Math.sin(headingRad)]
    // Aproximación local: para orientar signos alcanza con lng/lat crudos
    // (no hace falta la escala metro-por-grado, solo el signo del producto
    // punto), igual que el paso de orientación del backend.
    const edgeEnu: [number, number] = [end[0] - start[0], end[1] - start[1]]
    const alignment = edgeEnu[0] * cameraRightEnu[0] + edgeEnu[1] * cameraRightEnu[1]
    if (alignment < 0) {
      rightPerMeter = scale(rightPerMeter, -1)
      depthPerMeter = scale(depthPerMeter, -1)
    }
  }

  const metersToMercatorVertical = maplibregl.MercatorCoordinate.fromLngLat(
    { lng: start[0], lat: start[1] },
    0,
  ).meterInMercatorCoordinateUnits()
  const upPerMeter: Vec3 = [0, 0, metersToMercatorVertical]

  return { origin: startMerc, right: rightPerMeter, up: upPerMeter, depth: depthPerMeter }
}

/** Matriz 4x4 column-major (formato WebGL/gl-matrix) que lleva coordenadas
 * locales (x=a lo largo del muro en metros, y=altura en metros, z=profundidad
 * en metros) a coordenadas Mercator, lista para premultiplicar por la matriz
 * de proyección que MapLibre pasa a `render(gl, matrix)`. */
export function placementToModelMatrix(placement: FacadePlacement): Float32Array {
  const { origin, right, up, depth } = placement
  // prettier-ignore
  return new Float32Array([
    right[0], right[1], right[2], 0,
    up[0],    up[1],    up[2],    0,
    depth[0], depth[1], depth[2], 0,
    origin[0], origin[1], origin[2], 1,
  ])
}
