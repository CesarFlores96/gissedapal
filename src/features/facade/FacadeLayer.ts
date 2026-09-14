import type { CustomLayerInterface, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl"
import type { FeatureCollection, Geometry } from "geojson"

import type { BuildingFacade } from "../../types"
import { buildFacadeMesh } from "./facadeMesh"
import { computeFacadePlacement, placementToModelMatrix } from "./facadePlacement"

export const FACADE_LAYER_ID = "facade-2-5d-layer"
const DEBUG_SOURCE_ID = "facade-debug-source"
const DEBUG_LINE_LAYER_ID = "facade-debug-front-edge"
const DEBUG_POINT_LAYER_ID = "facade-debug-camera"

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec4 aColor;
  uniform mat4 uMatrix;
  varying vec4 vColor;
  void main() {
    gl_Position = uMatrix * vec4(aPosition, 1.0);
    vColor = aColor;
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
  }
`

function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("No se pudo crear el shader de la fachada 2.5D.")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Error compilando shader de fachada 2.5D: ${info ?? "desconocido"}`)
  }
  return shader
}

type RenderableFacade = {
  facade: BuildingFacade
  positionBuffer: WebGLBuffer
  colorBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
  modelMatrix: Float32Array
}

/**
 * Capa custom de MapLibre (WebGL puro, sin Three.js -- Fase 9: "prioriza
 * mantenibilidad") que dibuja la fachada procedural 2.5D de los lotes que el
 * LOD manager decide mostrar en detalle. Coexiste con `fill-extrusion`: no
 * reemplaza esas capas, solo se agrega encima para los lotes con detalle.
 *
 * Toda la lógica de "qué lotes mostrar" vive fuera de esta clase
 * (`facadeLOD.ts`); esta clase solo sabe construir/dibujar mallas para el
 * conjunto de fachadas que le pasen con `setFacades`.
 */
export class FacadeLayerManager {
  private map: MapLibreMap | null = null
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private attribLocations = { position: -1, color: -1 }
  private uniformLocations: { matrix: WebGLUniformLocation | null } = { matrix: null }
  private renderable = new Map<string, RenderableFacade>()
  private enabled = true
  private debug = false
  /** Todas las fachadas que `setFacades` recibió la última vez, incluidas
   * las que no pudieron construir malla/placement -- el overlay de debug
   * las usa a estas, no a `renderable`, para poder ver el `front_edge` de
   * un lote aunque el render 3D en sí haya fallado. */
  private lastFacades: BuildingFacade[] = []

  private readonly customLayer: CustomLayerInterface = {
    id: FACADE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd: (_map, gl) => this.onAdd(gl as WebGLRenderingContext),
    onRemove: () => this.onRemove(),
    render: (gl, matrix) => this.onRender(gl as WebGLRenderingContext, matrix as unknown as number[]),
  }

  attach(map: MapLibreMap): void {
    if (this.map) return
    this.map = map
    map.addLayer(this.customLayer)

    map.addSource(DEBUG_SOURCE_ID, { type: "geojson", data: emptyCollection() })
    map.addLayer({
      id: DEBUG_LINE_LAYER_ID,
      type: "line",
      source: DEBUG_SOURCE_ID,
      filter: ["==", ["get", "kind"], "front-edge"],
      layout: { visibility: "none" },
      paint: { "line-color": "#22d3ee", "line-width": 3 },
    })
    map.addLayer({
      id: DEBUG_POINT_LAYER_ID,
      type: "circle",
      source: DEBUG_SOURCE_ID,
      filter: ["==", ["get", "kind"], "camera"],
      layout: { visibility: "none" },
      paint: { "circle-color": "#f97316", "circle-radius": 5 },
    })
  }

  detach(): void {
    if (!this.map) return
    if (this.map.getLayer(DEBUG_POINT_LAYER_ID)) this.map.removeLayer(DEBUG_POINT_LAYER_ID)
    if (this.map.getLayer(DEBUG_LINE_LAYER_ID)) this.map.removeLayer(DEBUG_LINE_LAYER_ID)
    if (this.map.getSource(DEBUG_SOURCE_ID)) this.map.removeSource(DEBUG_SOURCE_ID)
    if (this.map.getLayer(FACADE_LAYER_ID)) this.map.removeLayer(FACADE_LAYER_ID)
    this.map = null
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.map?.triggerRepaint()
  }

  setDebug(debug: boolean): void {
    this.debug = debug
    if (!this.map) return
    const visibility = debug ? "visible" : "none"
    if (this.map.getLayer(DEBUG_LINE_LAYER_ID)) this.map.setLayoutProperty(DEBUG_LINE_LAYER_ID, "visibility", visibility)
    if (this.map.getLayer(DEBUG_POINT_LAYER_ID)) this.map.setLayoutProperty(DEBUG_POINT_LAYER_ID, "visibility", visibility)
    this.refreshDebugFeatures()
  }

  /** Reemplaza el conjunto de fachadas a dibujar en detalle. Reconstruye
   * mallas/buffers solo para lotes nuevos o con `version` distinta; libera
   * los buffers de lotes que salieron del conjunto (p. ej. el usuario se
   * alejó del zoom o del `MAX_DETAILED_FACADES`). */
  setFacades(facades: BuildingFacade[]): void {
    this.lastFacades = facades
    const nextIds = new Set(facades.map((facade) => facade.lotId))
    for (const [lotId, entry] of this.renderable) {
      if (!nextIds.has(lotId)) {
        this.disposeRenderable(entry)
        this.renderable.delete(lotId)
      }
    }

    for (const facade of facades) {
      const existing = this.renderable.get(facade.lotId)
      if (existing && existing.facade.version === facade.version && existing.facade.updatedAt === facade.updatedAt) {
        continue
      }
      const built = this.buildRenderable(facade)
      if (!built) continue
      if (existing) this.disposeRenderable(existing)
      this.renderable.set(facade.lotId, built)
    }

    console.info(
      `[FACADE] setFacades: ${facades.length} recibidas, ${this.renderable.size} renderizando, gl=${this.gl ? "ready" : "NULL"}`,
      facades.map((facade) => facade.lotId),
    )

    this.refreshDebugFeatures()
    this.map?.triggerRepaint()
  }

  private buildRenderable(facade: BuildingFacade): RenderableFacade | null {
    const gl = this.gl
    if (!gl) {
      console.warn(`[FACADE] lot=${facade.lotId}: onAdd todavía no corrió (gl nulo), no se puede dibujar`)
      return null
    }
    const mesh = buildFacadeMesh(facade)
    const placement = computeFacadePlacement(facade)
    if (!mesh || !placement) {
      console.warn(`[FACADE] lot=${facade.lotId}: no se pudo construir malla/placement`, {
        mesh: Boolean(mesh), placement: Boolean(placement),
        frontEdge: facade.gis.frontEdge, frontWidthM: facade.gis.frontWidthM, heightM: facade.dimensions.heightM,
      })
      return null
    }

    const positionBuffer = gl.createBuffer()
    const colorBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    if (!positionBuffer || !colorBuffer || !indexBuffer) return null

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)

    console.info(`[FACADE] lot=${facade.lotId}: malla construida`, {
      vertexCount: mesh.vertexCount, indexCount: mesh.indices.length,
      outlinePoints: facade.outline.length,
      windows: facade.windows.length, doors: facade.doors.length,
      garageDoors: facade.garageDoors.length, balconies: facade.balconies.length,
      wallColor: facade.wall.color, widthM: facade.gis.frontWidthM, heightM: facade.dimensions.heightM,
    })

    return {
      facade,
      positionBuffer,
      colorBuffer,
      indexBuffer,
      indexCount: mesh.indices.length,
      modelMatrix: placementToModelMatrix(placement),
    }
  }

  private disposeRenderable(entry: RenderableFacade): void {
    const gl = this.gl
    if (!gl) return
    gl.deleteBuffer(entry.positionBuffer)
    gl.deleteBuffer(entry.colorBuffer)
    gl.deleteBuffer(entry.indexBuffer)
  }

  private onAdd(gl: WebGLRenderingContext): void {
    this.gl = gl
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error("No se pudo crear el programa WebGL de la fachada 2.5D.")
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      throw new Error(`Error enlazando el programa de fachada 2.5D: ${info ?? "desconocido"}`)
    }
    this.program = program
    this.attribLocations = {
      position: gl.getAttribLocation(program, "aPosition"),
      color: gl.getAttribLocation(program, "aColor"),
    }
    this.uniformLocations = { matrix: gl.getUniformLocation(program, "uMatrix") }
  }

  private onRemove(): void {
    const gl = this.gl
    if (gl && this.program) gl.deleteProgram(this.program)
    for (const entry of this.renderable.values()) this.disposeRenderable(entry)
    this.renderable.clear()
    this.gl = null
    this.program = null
  }

  private onRender(gl: WebGLRenderingContext, matrix: number[]): void {
    if (!this.enabled || !this.program || this.renderable.size === 0) return

    gl.useProgram(this.program)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enableVertexAttribArray(this.attribLocations.position)
    gl.enableVertexAttribArray(this.attribLocations.color)

    for (const entry of this.renderable.values()) {
      const combined = multiplyMat4(matrix, entry.modelMatrix)
      gl.uniformMatrix4fv(this.uniformLocations.matrix, false, combined)

      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positionBuffer)
      gl.vertexAttribPointer(this.attribLocations.position, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.colorBuffer)
      gl.vertexAttribPointer(this.attribLocations.color, 4, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer)
      gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_SHORT, 0)
    }

    gl.disableVertexAttribArray(this.attribLocations.position)
    gl.disableVertexAttribArray(this.attribLocations.color)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
  }

  private refreshDebugFeatures(): void {
    if (!this.map || !this.debug) return
    const source = this.map.getSource(DEBUG_SOURCE_ID) as GeoJSONSource | undefined
    if (!source) return
    source.setData(buildDebugCollection(this.lastFacades))
  }
}

function emptyCollection(): FeatureCollection<Geometry, Record<string, unknown>> {
  return { type: "FeatureCollection", features: [] }
}

/** GeoJSON de apoyo para el overlay de debug (Fase 18): la arista frontal
 * elegida por `find_front_edge` y la posición de cámara que originó el
 * análisis, para poder ver a simple vista si el frente quedó bien puesto. */
function buildDebugCollection(facades: BuildingFacade[]): FeatureCollection<Geometry, Record<string, unknown>> {
  const features: FeatureCollection<Geometry, Record<string, unknown>>["features"] = []
  for (const facade of facades) {
    features.push({
      type: "Feature",
      properties: {
        kind: "front-edge",
        lotId: facade.lotId,
        bearing: facade.gis.frontBearing,
        widthM: facade.gis.frontWidthM,
        geometryConfidence: facade.confidence.geometry,
      },
      geometry: { type: "LineString", coordinates: facade.gis.frontEdge },
    })
    features.push({
      type: "Feature",
      properties: { kind: "camera", lotId: facade.lotId, heading: facade.source.heading },
      geometry: { type: "Point", coordinates: [facade.source.lng, facade.source.lat] },
    })
  }
  return { type: "FeatureCollection", features }
}
