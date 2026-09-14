import type { BuildingFacade, FacadeElement } from "../../types"

type Point = [number, number]

export type RectifiedFacade = {
  windows: FacadeElement[]
  doors: FacadeElement[]
  garageDoors: FacadeElement[]
  balconies: FacadeElement[]
}

const EPSILON = 1e-9

/** Resuelve A·x = b (8x8) por eliminación gaussiana con pivoteo parcial. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    if (Math.abs(m[pivot][col]) < EPSILON) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

/** Homografía que lleva `src[i]` a `dst[i]` (4 pares). */
export function homography(src: Point[], dst: Point[]): ((p: Point) => Point) | null {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const h = solve(a, b)
  if (!h) return null
  return ([x, y]) => {
    const w = h[6] * x + h[7] * y + 1
    // Del otro lado de la línea de fuga la proyección se invierte: sin sentido.
    if (w <= EPSILON) return [Number.NaN, Number.NaN]
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
  }
}

/** Ordena un cuadrilátero como arriba-izq, arriba-der, abajo-der, abajo-izq
 * (y crece hacia abajo), sin depender del orden en que lo devolvió Gemma/CV. */
function orderQuad(points: Point[]): Point[] {
  const byY = [...points].sort((p, q) => p[1] - q[1])
  const [tl, tr] = byY.slice(0, 2).sort((p, q) => p[0] - q[0])
  const [bl, br] = byY.slice(2).sort((p, q) => p[0] - q[0])
  return [tl, tr, br, bl]
}

function isConvexQuad(quad: Point[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i]
    const [bx, by] = quad[(i + 1) % 4]
    const [cx, cy] = quad[(i + 2) % 4]
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cross) < EPSILON) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

/**
 * Lleva las posiciones de la foto (coordenadas de imagen) al marco de la
 * fachada: el contorno del edificio pasa a ser el rectángulo completo
 * [0,1]x[0,1] (y=0 techo, y=1 suelo) y cada elemento se reubica relativo a
 * ese marco. Con 4 vértices usa homografía (corrige la perspectiva oblicua
 * de Street View); con otra cantidad, la caja envolvente. Elementos que caen
 * fuera del edificio se descartan.
 *
 * Sin este paso, un edificio que ocupa y=0.27..0.63 de la foto se dibujaba
 * como una franja flotando entre 1 y 2 m de altura.
 */
export function rectifyFacade(facade: BuildingFacade): RectifiedFacade {
  const outline = facade.outline.filter((p): p is Point => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const unit: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]]

  let map: (p: Point) => Point = (p) => p
  if (outline.length === 4 && isConvexQuad(orderQuad(outline))) {
    map = homography(orderQuad(outline), unit) ?? map
  } else if (outline.length >= 3) {
    const xs = outline.map(([x]) => x)
    const ys = outline.map(([, y]) => y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    if (x1 - x0 > EPSILON && y1 - y0 > EPSILON) map = ([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]
  }

  const project = (elements: FacadeElement[]): FacadeElement[] => {
    const result: FacadeElement[] = []
    for (const element of elements) {
      if (!(element.width > 0) || !(element.height > 0)) continue
      const corners: Point[] = [
        [element.x, element.y], [element.x + element.width, element.y],
        [element.x + element.width, element.y + element.height], [element.x, element.y + element.height],
      ].map((p) => map(p as Point))
      if (!corners.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) continue
      const clamp = (v: number) => Math.max(0, Math.min(1, v))
      const x0 = clamp(Math.min(...corners.map(([x]) => x)))
      const x1 = clamp(Math.max(...corners.map(([x]) => x)))
      const y0 = clamp(Math.min(...corners.map(([, y]) => y)))
      const y1 = clamp(Math.max(...corners.map(([, y]) => y)))
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue
      result.push({ ...element, x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
    }
    return result
  }

  return {
    windows: project(facade.windows),
    doors: project(facade.doors),
    garageDoors: project(facade.garageDoors),
    balconies: project(facade.balconies),
  }
}
