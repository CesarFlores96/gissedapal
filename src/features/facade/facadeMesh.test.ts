import { describe, expect, it } from "vitest"

import { buildFacadeMesh, FACADE_MAX_DEPTH_M, FACADE_Z_OFFSETS, PARAPET_HEIGHT_M, rebarColumnPositions } from "./facadeMesh"
import { makeFacade } from "./testFixtures"

// La fixture tiene 2 pisos: la curva visual de la caja da 6 m.
const H = 6

function zValues(positions: Float32Array): number[] {
  return Array.from(positions).filter((_, i) => i % 3 === 2)
}

/** Área de la cara frontal (z=0, orientada en el plano x,y) sumando triángulos. */
function frontFaceArea(mesh: NonNullable<ReturnType<typeof buildFacadeMesh>>): number {
  let area = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map((i) => i * 3)
    const zs = [mesh.positions[a + 2], mesh.positions[b + 2], mesh.positions[c + 2]]
    if (!zs.every((z) => Math.abs(z) < 1e-6)) continue
    const ux = mesh.positions[b] - mesh.positions[a]
    const uy = mesh.positions[b + 1] - mesh.positions[a + 1]
    const vx = mesh.positions[c] - mesh.positions[a]
    const vy = mesh.positions[c + 1] - mesh.positions[a + 1]
    area += Math.abs(ux * vy - uy * vx) / 2
  }
  return area
}

describe("buildFacadeMesh", () => {
  it("devuelve null cuando falta altura real (no se inventa una escala)", () => {
    const facade = makeFacade({ dimensions: { levels: null, heightM: null, widthM: 10, depthM: 0.5 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("devuelve null cuando el ancho GIS es 0 o negativo", () => {
    const facade = makeFacade({ gis: { frontEdge: [[0, 0], [0, 0]], frontWidthM: 0, frontBearing: 0 } })
    expect(buildFacadeMesh(facade)).toBeNull()
  })

  it("una fachada sin elementos es una losa: cara frontal completa en z=0 y espesor detrás", () => {
    const mesh = buildFacadeMesh(makeFacade())!
    expect(mesh.indices.length % 3).toBe(0)
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * H, 4)
    const zs = zValues(mesh.positions)
    // Lo único que sobresale sin elementos son la losa entre pisos y la cornisa.
    expect(Math.max(...zs)).toBeCloseTo(FACADE_Z_OFFSETS.cornice, 6)
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 6)
  })

  it("el espesor queda acotado a la maqueta (nunca la profundidad real del predio)", () => {
    const mesh = buildFacadeMesh(makeFacade({ dimensions: { levels: 2, heightM: 5.6, widthM: 10, depthM: 25 } }))!
    expect(Math.min(...zValues(mesh.positions))).toBeCloseTo(-FACADE_MAX_DEPTH_M, 6)
  })

  it("una ventana abre un hueco real en la cara frontal y su fondo queda recedido", () => {
    const window = { x: 0.2, y: 0.3, width: 0.15, height: 0.2, floor: 1 }
    const mesh = buildFacadeMesh(makeFacade({ windows: [window] }))!
    // Regularizada: 1.5 m de ancho, antepecho/dintel del 2do piso (0.3..0.8 de 3 m).
    const holeArea = 1.5 * (0.8 - 0.3) * (H / 2)
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * H - holeArea, 4)
    expect(zValues(mesh.positions).some((z) => Math.abs(z - FACADE_Z_OFFSETS.window) < 1e-6)).toBe(true)
  })

  it("descarta elementos con ancho o alto no positivo", () => {
    const mesh = buildFacadeMesh(makeFacade({ doors: [{ x: 0.1, y: 0.1, width: 0, height: 0.3 }] }))!
    const baseline = buildFacadeMesh(makeFacade())!
    expect(mesh.positions.length).toBe(baseline.positions.length)
  })

  it("un balcon sobresale hacia la calle (Z positivo) sin abrir hueco", () => {
    const mesh = buildFacadeMesh(makeFacade({ balconies: [{ x: 0.4, y: 0.45, width: 0.2, height: 0.05, piso: 2 }] }))!
    expect(Math.max(...zValues(mesh.positions))).toBeCloseTo(FACADE_Z_OFFSETS.balcony, 5)
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * H, 4)
  })

  it("usa la altura de la caja del lote cuando se conoce", () => {
    const mesh = buildFacadeMesh(makeFacade(), { boxLevels: 1 })!
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * 3, 4)
  })

  it("la cara frontal cubre todo el frente desde el suelo aunque el edificio ocupe una franja de la foto", () => {
    // Caso real del bug: edificio en y=0.27..0.63 de la imagen se dibujaba flotando.
    const mesh = buildFacadeMesh(makeFacade({ outline: [[0.09, 0.33], [0.94, 0.27], [0.91, 0.63], [0.05, 0.57]] }))!
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * H, 4)
    const frontYs: number[] = []
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i + 2]) < 1e-6) frontYs.push(mesh.positions[i + 1])
    }
    expect(Math.min(...frontYs)).toBeCloseTo(0, 6)
    expect(Math.max(...frontYs)).toBeCloseTo(H, 6)
  })

  it("marca una losa saliente por cada cambio de piso", () => {
    const bandFronts = (mesh: NonNullable<ReturnType<typeof buildFacadeMesh>>) => {
      const ys = new Set<number>()
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (Math.abs(mesh.positions[i + 2] - FACADE_Z_OFFSETS.floorBand) < 1e-6) ys.add(Math.round(mesh.positions[i + 1] * 100))
      }
      return ys.size / 2
    }
    expect(bandFronts(buildFacadeMesh(makeFacade(), { boxLevels: 1 })!)).toBe(0)
    expect(bandFronts(buildFacadeMesh(makeFacade(), { boxLevels: 3 })!)).toBe(2)
  })

  it("pinta cada piso con su color cuando la fachada los trae", () => {
    const mesh = buildFacadeMesh(makeFacade({
      floors: [{ level: 1, color: "#FF0000" }, { level: 2, color: "#0000FF" }],
    }))!
    // Colores de los triángulos de la cara frontal (z=0), por altura de su centro.
    const frontColorsBetween = (yMin: number, yMax: number) => {
      const found = new Set<string>()
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const vs = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
        if (!vs.every((v) => Math.abs(mesh.positions[v * 3 + 2]) < 1e-6)) continue
        const cy = vs.reduce((sum, v) => sum + mesh.positions[v * 3 + 1], 0) / 3
        if (cy > yMin && cy < yMax) found.add(Array.from(mesh.colors.slice(vs[0] * 4, vs[0] * 4 + 3)).join(","))
      }
      return found
    }
    expect(frontColorsBetween(0, H / 2)).toEqual(new Set(["1,0,0"]))
    expect(frontColorsBetween(H / 2, H)).toEqual(new Set(["0,0,1"]))
  })

  it("agrega parapeto sobre el último piso solo si la fachada lo indica", () => {
    const maxY = (mesh: NonNullable<ReturnType<typeof buildFacadeMesh>>) =>
      Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1))
    expect(maxY(buildFacadeMesh(makeFacade())!)).toBeCloseTo(H, 6)
    expect(maxY(buildFacadeMesh(makeFacade({ roof: { type: "plano", parapet: true } }))!)).toBeCloseTo(H + PARAPET_HEIGHT_M, 6)
  })

  it("una puerta con reja agrega barrotes delante del fondo recedido", () => {
    const door = { x: 0.1, y: 0.6, width: 0.2, height: 0.4 }
    const plain = buildFacadeMesh(makeFacade({ doors: [door] }))!
    const grilled = buildFacadeMesh(makeFacade({ doors: [{ ...door, reja: true, color_hex: "#1F5E3A" }] }))!
    expect(grilled.vertexCount).toBeGreaterThan(plain.vertexCount)
    const barZ = FACADE_Z_OFFSETS.door + 0.03
    expect(zValues(grilled.positions).some((z) => Math.abs(z - barZ) < 1e-6)).toBe(true)
  })

  it("con foto: la cara frontal es un único rectángulo texturizado sin huecos ni marcos encima", () => {
    const facade = makeFacade({
      windows: [{ x: 0.2, y: 0.3, width: 0.15, height: 0.2 }],
      doors: [{ x: 0.1, y: 0.6, width: 0.2, height: 0.4, reja: true }],
      roof: { type: "plano", parapet: true },
    })
    const mesh = buildFacadeMesh(facade, { textured: true })!
    expect(frontFaceArea(mesh)).toBeCloseTo(10 * H, 4)
    const textured: [number, number][] = []
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      if (mesh.uvs[v * 3 + 2] === 1) textured.push([mesh.uvs[v * 3], mesh.uvs[v * 3 + 1]])
    }
    expect(textured).toHaveLength(4)
    expect(textured.map(([u]) => u).sort()).toEqual([0, 0, 1, 1])
    // v=0 arriba de la foto = techo del edificio.
    const topVertex = Array.from({ length: mesh.vertexCount }, (_, v) => v)
      .find((v) => mesh.uvs[v * 3 + 2] === 1 && Math.abs(mesh.positions[v * 3 + 1] - H) < 1e-6)!
    expect(mesh.uvs[topVertex * 3 + 1]).toBeCloseTo(0, 6)
    // Nada sobresale de la foto (ni marcos, ni losas, ni parapeto).
    expect(Math.max(...zValues(mesh.positions))).toBeCloseTo(0, 6)
    expect(Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1))).toBeCloseTo(H, 6)
  })

  it("sin foto ningún vértice pide textura", () => {
    const mesh = buildFacadeMesh(makeFacade({ windows: [{ x: 0.2, y: 0.3, width: 0.15, height: 0.2 }] }))!
    expect(Array.from(mesh.uvs).filter((_, i) => i % 3 === 2).every((mix) => mix === 0)).toBe(true)
  })

  it("todas las normales son unitarias", () => {
    const mesh = buildFacadeMesh(makeFacade({
      doors: [{ x: 0.1, y: 0.6, width: 0.2, height: 0.4, reja: true }],
      roof: { type: "plano", parapet: true, tanks: [{ x: 0.5, width: 0.1, kind: "plastico", color: null }], rebar: true },
    }))!
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(1, 5)
    }
  })

  it("pone los tanques sobre la azotea, detrás de la losa y dentro del frente", () => {
    const withoutTank = buildFacadeMesh(makeFacade())!
    const mesh = buildFacadeMesh(makeFacade({
      roof: { type: "plano", parapet: false, tanks: [{ x: 0.45, width: 0.1, kind: "plastico", color: "#1F2326" }], rebar: false },
    }))!
    expect(mesh.vertexCount).toBeGreaterThan(withoutTank.vertexCount)
    const extra = Array.from({ length: mesh.vertexCount - withoutTank.vertexCount }, (_, i) => (withoutTank.vertexCount + i) * 3)
    for (const at of extra) {
      expect(mesh.positions[at + 1]).toBeGreaterThanOrEqual(H - 1e-6)
      expect(mesh.positions[at + 2]).toBeLessThan(-0.5)
      expect(mesh.positions[at]).toBeGreaterThan(0)
      expect(mesh.positions[at]).toBeLessThan(10)
    }
  })

  it("con fierros expuestos agrega columnas sobre el techo o el parapeto", () => {
    const maxY = (mesh: NonNullable<ReturnType<typeof buildFacadeMesh>>) =>
      Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1))
    const flat = buildFacadeMesh(makeFacade({ roof: { type: "plano", parapet: false, rebar: true } }))!
    const withParapet = buildFacadeMesh(makeFacade({ roof: { type: "plano", parapet: true, rebar: true } }))!
    expect(maxY(flat)).toBeGreaterThan(H + 0.9)
    expect(maxY(withParapet)).toBeGreaterThan(H + PARAPET_HEIGHT_M + 0.9)
  })

  it("reparte columnas de fierro en las esquinas y cada ~3.5 m", () => {
    const columns = rebarColumnPositions(10)
    expect(columns[0]).toBeCloseTo(0.25, 6)
    expect(columns[columns.length - 1]).toBeCloseTo(9.75, 6)
    expect(columns).toHaveLength(4)
    expect(rebarColumnPositions(0.8)).toEqual([0.4])
  })

  it("usa una fachada rectangular estandar cuando el outline tiene menos de 3 puntos", () => {
    const mesh = buildFacadeMesh(makeFacade({ outline: [[0, 0]] }))
    expect(mesh).not.toBeNull()
    expect(frontFaceArea(mesh!)).toBeCloseTo(10 * H, 4)
  })
})
