import type { CustomLayerInterface, CustomRenderMethodInput, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl"
import type { FeatureCollection, Geometry } from "geojson"

import type { BuildingFacade } from "../../types"
import { lightInFacadeSpace, type MapLight, mapLightDirection } from "./facadeLighting"
import { loadFacadeTexture } from "./facadeLoader"
import { buildFacadeMesh, FACADE_BOX_GAP_M, facadeDepthM } from "./facadeMesh"
import { computeFacadePlacement, placementToModelMatrix } from "./facadePlacement"

export const FACADE_LAYER_ID = "facade-2-5d-layer"
const DEBUG_SOURCE_ID = "facade-debug-source"
const DEBUG_LINE_LAYER_ID = "facade-debug-front-edge"
const DEBUG_POINT_LAYER_ID = "facade-debug-camera"

/** Solo las fachadas más prioritarias llevan foto: una textura de 768 px
 * ocupa ~2 MB de GPU y el LOD puede pedir hasta 60 fachadas. */
export const MAX_TEXTURED_FACADES = 24

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec4 aColor;
  attribute vec3 aNormal;
  attribute vec3 aUv;
  uniform mat4 uMatrix;
  uniform vec3 uLight;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vTexMix;
  varying float vDiffuse;
  void main() {
    gl_Position = uMatrix * vec4(aPosition, 1.0);
    vColor = aColor;
    vUv = aUv.xy;
    vTexMix = aUv.z;
    vDiffuse = max(dot(normalize(aNormal), uLight), 0.0);
  }
`

// Misma escala que `fill-extrusion` de MapLibre (intensidad 0.5: la cara en
// sombra queda a la mitad). La foto ya trae su propia luz, así que sobre ella
// el sombreado es más suave: solo lo necesario para que los costados se lean.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vTexMix;
  varying float vDiffuse;
  void main() {
    float photo = vTexMix * uHasTexture;
    vec3 base = mix(vColor.rgb, texture2D(uTexture, vUv).rgb, photo);
    float light = mix(0.5 + 0.5 * vDiffuse, 0.8 + 0.2 * vDiffuse, photo);
    gl_FragColor = vec4(base * light * vColor.a, vColor.a);
  }
`

// Float64 a propósito: el origen de la fachada en Mercator (~0.28) y la
// escala por metro (~2.5e-8) no entran juntos en Float32 sin perder ~1 m.
// Recién el resultado (clip space, magnitudes O(1)) se baja a Float32.
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
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

function textureKey(facade: BuildingFacade): string {
  return `${facade.lotId}:${facade.version}:${facade.updatedAt ?? ""}`
}

type RenderableFacade = {
  facade: BuildingFacade
  boxLevels: number | null
  textured: boolean
  buffers: { position: WebGLBuffer; color: WebGLBuffer; normal: WebGLBuffer; uv: WebGLBuffer; index: WebGLBuffer }
  indexCount: number
  modelMatrix: Float64Array
  right: [number, number, number]
  depth: [number, number, number]
}

type TextureEntry = {
  key: string
  status: "loading" | "decoded" | "ready" | "failed"
  image: HTMLImageElement | null
  texture: WebGLTexture | null
}

type Desired = { facade: BuildingFacade; boxLevels: number | null; wantsTexture: boolean }

export type FacadeLayerOptions = {
  /** Data URL de la foto rectificada; inyectable para pruebas. */
  loadTexture?: (facade: BuildingFacade) => Promise<string | null>
}

/**
 * Capa custom de MapLibre (WebGL puro, sin Three.js) que dibuja la fachada
 * 2.5D de los lotes que el LOD manager decide mostrar en detalle, apoyada
 * delante de la caja `fill-extrusion` del lote.
 *
 * Todo recurso WebGL (buffers, texturas) se crea dentro de `render`: MapLibre
 * cachea el estado de GL (VAO, buffer y textura enlazados) y solo lo
 * reinicia alrededor de las capas custom, así que tocarlo desde un callback
 * async lo desincronizaría. `setFacades` y la carga de fotos solo dejan
 * pendiente el trabajo; `render` lo aplica.
 */
export class FacadeLayerManager {
  private map: MapLibreMap | null = null
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private attribs = { position: -1, color: -1, normal: -1, uv: -1 }
  private uniforms: {
    matrix: WebGLUniformLocation | null
    light: WebGLUniformLocation | null
    texture: WebGLUniformLocation | null
    hasTexture: WebGLUniformLocation | null
  } = { matrix: null, light: null, texture: null, hasTexture: null }
  private renderable = new Map<string, RenderableFacade>()
  private textures = new Map<string, TextureEntry>()
  private desired: Desired[] = []
  private dirty = false
  private enabled = true
  private debug = false
  private readonly loadTexture: (facade: BuildingFacade) => Promise<string | null>
  /** Todas las fachadas que `setFacades` recibió la última vez, incluidas
   * las que no pudieron construir malla/placement -- el overlay de debug las
   * usa para poder ver el `front_edge` aunque el render 3D haya fallado. */
  private lastFacades: BuildingFacade[] = []

  constructor(options: FacadeLayerOptions = {}) {
    this.loadTexture = options.loadTexture ?? ((facade) => loadFacadeTexture(facade.lotId, textureKey(facade)))
  }

  private readonly customLayer: CustomLayerInterface = {
    id: FACADE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd: (_map, gl) => this.onAdd(gl as WebGLRenderingContext),
    onRemove: () => this.onRemove(),
    // MapLibre 5 pasa un objeto de opciones, no la matriz. Su
    // `modelViewProjectionMatrix` espera píxeles de mundo; la que recibe
    // Mercator 0..1 -- lo que produce `placementToModelMatrix` -- es
    // `defaultProjectionData.mainMatrix` (verificado en navegador).
    render: (gl, options: CustomRenderMethodInput) => this.onRender(gl as WebGLRenderingContext, options.defaultProjectionData.mainMatrix),
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

  /** Reemplaza el conjunto de fachadas a dibujar, en orden de prioridad (las
   * primeras `MAX_TEXTURED_FACADES` con foto la llevan). La reconstrucción
   * real ocurre en el próximo frame. */
  setFacades(facades: BuildingFacade[], boxLevelsByLot: ReadonlyMap<string, number> = new Map()): void {
    this.lastFacades = facades
    this.desired = facades.map((facade, index) => ({
      facade,
      boxLevels: boxLevelsByLot.get(facade.lotId) ?? this.renderable.get(facade.lotId)?.boxLevels ?? null,
      wantsTexture: Boolean(facade.texture) && index < MAX_TEXTURED_FACADES,
    }))
    for (const { facade, wantsTexture } of this.desired) {
      if (wantsTexture) this.requestTexture(facade)
    }
    this.dirty = true
    this.refreshDebugFeatures()
    this.map?.triggerRepaint()
  }

  private requestTexture(facade: BuildingFacade): void {
    const key = textureKey(facade)
    const existing = this.textures.get(facade.lotId)
    if (existing && existing.key === key) return
    const entry: TextureEntry = { key, status: "loading", image: null, texture: null }
    // La foto vieja (fachada reanalizada) se libera en el próximo frame.
    if (existing?.texture) this.pendingDeletes.push(existing.texture)
    this.textures.set(facade.lotId, entry)

    this.loadTexture(facade)
      .then(async (dataUrl) => {
        if (!dataUrl) throw new Error("sin textura")
        const image = new Image()
        image.src = dataUrl
        await image.decode()
        return image
      })
      .then((image) => {
        if (this.textures.get(facade.lotId) !== entry) return
        entry.image = image
        entry.status = "decoded"
        this.dirty = true
        this.map?.triggerRepaint()
      })
      .catch((error: unknown) => {
        if (this.textures.get(facade.lotId) !== entry) return
        entry.status = "failed"
        console.warn(`[FACADE] lot=${facade.lotId}: sin foto, se usa la fachada procedural`, error)
        this.dirty = true
        this.map?.triggerRepaint()
      })
  }

  private pendingDeletes: WebGLTexture[] = []

  /** Aplica en GL lo que `setFacades` y la carga de fotos dejaron pendiente. */
  private sync(gl: WebGLRenderingContext): void {
    for (const texture of this.pendingDeletes) gl.deleteTexture(texture)
    this.pendingDeletes = []
    if (!this.dirty) return
    this.dirty = false

    const wanted = new Set(this.desired.map(({ facade }) => facade.lotId))
    const texturedLots = new Set(this.desired.filter((d) => d.wantsTexture).map((d) => d.facade.lotId))
    for (const [lotId, entry] of this.renderable) {
      if (!wanted.has(lotId)) {
        this.disposeRenderable(gl, entry)
        this.renderable.delete(lotId)
      }
    }
    for (const [lotId, entry] of this.textures) {
      if (!texturedLots.has(lotId)) {
        if (entry.texture) gl.deleteTexture(entry.texture)
        this.textures.delete(lotId)
      }
    }

    let built = 0
    for (const { facade, boxLevels, wantsTexture } of this.desired) {
      const textureEntry = wantsTexture ? this.textures.get(facade.lotId) : undefined
      if (textureEntry?.status === "decoded" && textureEntry.image) {
        textureEntry.texture = this.uploadTexture(gl, textureEntry.image)
        textureEntry.image = null
        textureEntry.status = textureEntry.texture ? "ready" : "failed"
      }
      const textured = textureEntry?.status === "ready" && textureEntry.texture !== null
      const existing = this.renderable.get(facade.lotId)
      if (
        existing
        && existing.facade.version === facade.version
        && existing.facade.updatedAt === facade.updatedAt
        && existing.boxLevels === boxLevels
        && existing.textured === textured
      ) {
        continue
      }
      const next = this.buildRenderable(gl, facade, boxLevels, textured)
      if (existing) this.disposeRenderable(gl, existing)
      if (next) {
        this.renderable.set(facade.lotId, next)
        built += 1
      } else {
        this.renderable.delete(facade.lotId)
      }
    }
    if (built > 0) {
      console.info(`[FACADE] ${this.renderable.size} fachadas dibujadas (${built} reconstruidas, ${[...this.renderable.values()].filter((r) => r.textured).length} con foto)`)
    }
  }

  private uploadTexture(gl: WebGLRenderingContext, image: HTMLImageElement): WebGLTexture | null {
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)
    const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // Mipmaps (WebGL2 los admite en texturas no potencia de 2): sin ellos la
    // foto titila al alejarse.
    if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    gl.bindTexture(gl.TEXTURE_2D, null)
    return texture
  }

  private buildRenderable(gl: WebGLRenderingContext, facade: BuildingFacade, boxLevels: number | null, textured: boolean): RenderableFacade | null {
    const mesh = buildFacadeMesh(facade, { boxLevels, textured })
    const placement = computeFacadePlacement(facade)
    if (!mesh || !placement) {
      console.warn(`[FACADE] lot=${facade.lotId}: no se pudo construir malla/placement`, {
        mesh: Boolean(mesh), placement: Boolean(placement),
        frontEdge: facade.gis.frontEdge, frontWidthM: facade.gis.frontWidthM, heightM: facade.dimensions.heightM,
      })
      return null
    }
    const upload = (target: number, data: Float32Array | Uint16Array): WebGLBuffer | null => {
      const buffer = gl.createBuffer()
      if (!buffer) return null
      gl.bindBuffer(target, buffer)
      gl.bufferData(target, data as unknown as ArrayBufferView<ArrayBuffer>, gl.STATIC_DRAW)
      return buffer
    }
    const position = upload(gl.ARRAY_BUFFER, mesh.positions)
    const color = upload(gl.ARRAY_BUFFER, mesh.colors)
    const normal = upload(gl.ARRAY_BUFFER, mesh.normals)
    const uv = upload(gl.ARRAY_BUFFER, mesh.uvs)
    const index = upload(gl.ELEMENT_ARRAY_BUFFER, mesh.indices)
    if (!position || !color || !normal || !uv || !index) return null

    return {
      facade,
      boxLevels,
      textured,
      buffers: { position, color, normal, uv, index },
      indexCount: mesh.indices.length,
      modelMatrix: placementToModelMatrix(placement, facadeDepthM(facade) + FACADE_BOX_GAP_M),
      right: placement.right,
      depth: placement.depth,
    }
  }

  private disposeRenderable(gl: WebGLRenderingContext, entry: RenderableFacade): void {
    for (const buffer of Object.values(entry.buffers)) gl.deleteBuffer(buffer)
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
    this.attribs = {
      position: gl.getAttribLocation(program, "aPosition"),
      color: gl.getAttribLocation(program, "aColor"),
      normal: gl.getAttribLocation(program, "aNormal"),
      uv: gl.getAttribLocation(program, "aUv"),
    }
    this.uniforms = {
      matrix: gl.getUniformLocation(program, "uMatrix"),
      light: gl.getUniformLocation(program, "uLight"),
      texture: gl.getUniformLocation(program, "uTexture"),
      hasTexture: gl.getUniformLocation(program, "uHasTexture"),
    }
    this.dirty = true
  }

  private onRemove(): void {
    const gl = this.gl
    if (gl) {
      if (this.program) gl.deleteProgram(this.program)
      for (const entry of this.renderable.values()) this.disposeRenderable(gl, entry)
      for (const entry of this.textures.values()) if (entry.texture) gl.deleteTexture(entry.texture)
      for (const texture of this.pendingDeletes) gl.deleteTexture(texture)
    }
    this.renderable.clear()
    this.textures.clear()
    this.pendingDeletes = []
    this.gl = null
    this.program = null
  }

  private onRender(gl: WebGLRenderingContext, matrix: ArrayLike<number>): void {
    if (!this.enabled || !this.program) return
    this.sync(gl)
    if (this.renderable.size === 0) return

    gl.useProgram(this.program)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const attributes: [number, number, number][] = [
      [this.attribs.position, 3, 0], [this.attribs.color, 4, 1], [this.attribs.normal, 3, 2], [this.attribs.uv, 3, 3],
    ]
    for (const [location] of attributes) if (location >= 0) gl.enableVertexAttribArray(location)

    const light = mapLightDirection(this.map?.getLight() as MapLight | undefined, this.map?.getBearing() ?? 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(this.uniforms.texture, 0)

    for (const entry of this.renderable.values()) {
      gl.uniformMatrix4fv(this.uniforms.matrix, false, new Float32Array(multiplyMat4(matrix, entry.modelMatrix)))
      gl.uniform3fv(this.uniforms.light, lightInFacadeSpace(light, entry.right, entry.depth))
      const texture = entry.textured ? this.textures.get(entry.facade.lotId)?.texture ?? null : null
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1f(this.uniforms.hasTexture, texture ? 1 : 0)

      const buffers = [entry.buffers.position, entry.buffers.color, entry.buffers.normal, entry.buffers.uv]
      for (const [location, size, slot] of attributes) {
        if (location < 0) continue
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[slot])
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.buffers.index)
      gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_SHORT, 0)
    }

    for (const [location] of attributes) if (location >= 0) gl.disableVertexAttribArray(location)
    gl.bindTexture(gl.TEXTURE_2D, null)
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
