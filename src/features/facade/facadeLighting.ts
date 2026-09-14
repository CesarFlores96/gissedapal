export type Vec3 = [number, number, number]

export type MapLight = {
  /** [radial, azimutal°, polar°] como `light.position` del estilo de MapLibre. */
  position?: [number, number, number]
  anchor?: "map" | "viewport"
}

const DEFAULT_LIGHT_POSITION: [number, number, number] = [1.15, 210, 30]

/**
 * Dirección hacia la luz en coordenadas de mundo Mercator (x=este, y=sur,
 * z=arriba), con la misma fórmula que usa MapLibre para `fill-extrusion`
 * (`sphericalToCartesian` + rotación por bearing cuando el ancla es la
 * vista). Así la fachada queda sombreada igual que las cajas vecinas y al
 * girar el mapa ambas cambian juntas.
 */
export function mapLightDirection(light: MapLight | undefined, bearingDeg: number): Vec3 {
  const [radial, azimuthalDeg, polarDeg] = light?.position ?? DEFAULT_LIGHT_POSITION
  const azimuthal = ((azimuthalDeg + 90) * Math.PI) / 180
  const polar = (polarDeg * Math.PI) / 180
  let x = radial * Math.cos(azimuthal) * Math.sin(polar)
  let y = radial * Math.sin(azimuthal) * Math.sin(polar)
  const z = radial * Math.cos(polar)
  if ((light?.anchor ?? "viewport") === "viewport") {
    const angle = (bearingDeg * Math.PI) / 180
    const rx = Math.cos(angle) * x - Math.sin(angle) * y
    const ry = Math.sin(angle) * x + Math.cos(angle) * y
    x = rx
    y = ry
  }
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function unitXY(v: ArrayLike<number>): [number, number] {
  const length = Math.hypot(v[0], v[1]) || 1
  return [v[0] / length, v[1] / length]
}

/** La misma luz expresada en el espacio local de la fachada (x=a lo largo
 * del frente, y=arriba, z=hacia la calle), que es donde viven las normales
 * de la malla. `right`/`depth` son los ejes de `computeFacadePlacement`. */
export function lightInFacadeSpace(light: Vec3, right: ArrayLike<number>, depth: ArrayLike<number>): Vec3 {
  const [rx, ry] = unitXY(right)
  const [dx, dy] = unitXY(depth)
  return [light[0] * rx + light[1] * ry, light[2], light[0] * dx + light[1] * dy]
}
