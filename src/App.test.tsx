import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { routes } from "./app/routes"
import { clearAlertsCache } from "./features/alerts/dropsCache"
import { clearCoverageCache } from "./features/map/coverageCache"
import { clearSupplyCaches } from "./features/selection/supplyCaches"
import type { GisLayersResponse, SupplyDetail } from "./types"

const ipc = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  fetchGisLayers: vi.fn(),
  fetchDistricts: vi.fn(),
  getAbruptConsumptionDrops: vi.fn(),
  getSession: vi.fn(),
  getReportsMaster: vi.fn(),
  getSupplyDetail: vi.fn(),
  getSupplyConsumption: vi.fn(),
  getSupplyReport: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  relaunchApp: vi.fn(),
  resolveLocation: vi.fn(),
  saveGeometryCorrection: vi.fn(),
  searchCadastre: vi.fn(),
}))

vi.mock("./lib/ipc", () => ipc)
vi.mock("./features/map/lotContext", () => ({ getTileServerUrl: vi.fn().mockResolvedValue("http://127.0.0.1:0") }))
vi.mock("./components/MapView", () => ({
  MapView: ({ adjustmentMode, onAdjustmentDeltaChange, onBoundsChange, onCadastralSelect, onSupplySelect }: {
    adjustmentMode: boolean
    onAdjustmentDeltaChange: (delta: { lng: number; lat: number }) => void
    onBoundsChange: (bbox: [number, number, number, number], zoom: number) => void
    onCadastralSelect: (selection: { id: string; kind: "lot"; properties: Record<string, unknown> }) => void
    onSupplySelect: (code: string) => void
  }) => (
    <div>
      <button onClick={() => onBoundsChange([-77.2, -12.2, -76.9, -11.9], 16)} type="button">Cargar BBOX</button>
      <button onClick={() => onCadastralSelect({ id: "l-1", kind: "lot", properties: { district: "EL AGUSTINO", district_code: "010", block_code: "29849", lot_code: "1345763", cup_code: "010001330100", property_code: "10", lot_type_code: "TL001" } })} type="button">Seleccionar lote</button>
      <button onClick={() => onSupplySelect("100001")} type="button">Seleccionar suministro</button>
      {adjustmentMode ? <button onClick={() => onAdjustmentDeltaChange({ lng: 0.0001, lat: -0.0002 })} type="button">Mover geometría</button> : null}
    </div>
  ),
}))

function layerResponse(page: number, hasMore: boolean): GisLayersResponse {
  return {
    bbox: { minx: -77.2, miny: -12.2, maxx: -76.9, maxy: -11.9 },
    layers: {
      distritos: {
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            id: "d-1",
            geometry: { type: "Polygon", coordinates: [[[-77.1, -12.1], [-77, -12.1], [-77, -12], [-77.1, -12.1]]] },
            properties: { name: "Lima", supply_count: 123 },
          }],
        },
        meta: { available: true, total: 1, hasMore: false },
      },
      suministros: {
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            id: `s-${page}`,
            geometry: { type: "Point", coordinates: [-77.04, -12.04] },
            properties: { supply_code: `10000${page}` },
          }],
        },
        meta: { available: true, page, pageSize: 1, total: 2, totalPages: 2, hasMore },
      },
    },
  }
}

const detail: SupplyDetail = {
  supply: { id: "1", code: "100001", customerName: "Cliente prueba", address: "Lima", status: "activo", locationSource: "database", locationQuality: "exact" },
  geometry: { type: "Point", coordinates: [-77.04, -12.04] },
  meter: { code: "M-1", diameter: "15", installationDate: "2025-01-01", status: "instalado" },
  hierarchy: { district: "Lima", quadrant: "S01", lot: "L01", provisional: true, geometryAvailable: false },
  cadastre: {
    districtCode: "001",
    districtName: "LIMA",
    districtMatchStatus: "MATCHED",
    blockCode: "00100001",
    cupCode: "001000010001",
    geometryMatchStatus: "UNIQUE_GEOMETRY",
    geometryCount: 1,
    cuaCode: "0200",
    cuaLabel: "SERVICIO DOMESTICO",
    cuaCatalogDescription: "SERVICIO DOMESTICO",
    cuaMatchMethod: "EXACT",
  },
  cadastralLink: { kind: "lot", recordId: "l-1", code: "1345763", blockCode: "29849", method: "CUPCODE" },
  consumption: null,
  consumptionLoading: false,
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)) })
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("GIS application through simulated IPC", () => {
  let root: Root

  /** Monta la tabla de rutas real con una historia limpia por caso. */
  async function render(initialEntry = "/mapa"): Promise<void> {
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await settle()
  }

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = '<div id="root"></div>'
    window.localStorage.clear()
    // Las cachés viven en ámbito de módulo, así que se filtrarían entre casos.
    clearSupplyCaches()
    clearCoverageCache()
    clearAlertsCache()
    root = createRoot(document.querySelector("#root") as HTMLDivElement)
    ipc.checkForUpdate.mockResolvedValue(null)
    ipc.getSession.mockResolvedValue({ authenticated: true, user: { id: "u1", email: "gis@sedapal.test" } })
    ipc.fetchGisLayers.mockImplementation(({ page }: { page: number }) => Promise.resolve(layerResponse(page, page === 1)))
    ipc.fetchDistricts.mockResolvedValue([
      { code: "002", name: "Ancón", supplyCount: 8, bounds: [-77.2, -11.8, -77.0, -11.6], center: [-77.1, -11.7] },
      { code: "001", name: "Lima", supplyCount: 123, bounds: [-77.1, -12.1, -77.0, -12.0], center: [-77.05, -12.05] },
    ])
    ipc.getSupplyDetail.mockResolvedValue(detail)
    ipc.getSupplyConsumption.mockResolvedValue(null)
    ipc.getAbruptConsumptionDrops.mockResolvedValue({ total: 0, items: [] })
    ipc.getReportsMaster.mockResolvedValue({ data: [], page: 1, pageSize: 25, total: 0, summary: { fuentePropiaDebt: 0, grandesClientesDebt: 0, totalDebt: 0 } })
    ipc.saveGeometryCorrection.mockResolvedValue({
      targetKind: "lot", targetId: "l-1", deltaLng: 0.0001, deltaLat: -0.0002,
      limited: false, limitReason: null, reset: false,
    })
    ipc.searchCadastre.mockImplementation((query: string) => Promise.resolve(query === "29849" ? [{
      id: "block-search-1",
      kind: "block",
      code: "29849",
      center: [-77.01, -12.04],
      properties: { district: "EL AGUSTINO", district_code: "010", block_code: "29849", lot_count: 18 },
    }] : [{
      id: "lot-search-1",
      kind: "lot",
      code: "1400279",
      center: [-77.01, -12.04],
      properties: { district: "EL AGUSTINO", district_code: "010", block_code: "30963", lot_code: "1400279", cup_code: "010012540040", lot_type_code: "TL001", area_m2: 120.5, perimeter_m: 44.2 },
    }]))
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
  })

  it("redirige al login cuando no hay sesión autenticada", async () => {
    ipc.getSession.mockResolvedValue({ authenticated: false, user: null })
    await render()

    expect(document.body.textContent).toContain("Ingresar")
    expect(document.querySelector('nav[aria-label="Navegación principal"]')).toBeNull()
  })

  it("pagina el encuadre y reutiliza la cobertura ya descargada", async () => {
    await render()

    const loadButton = findButton("Cargar BBOX")
    expect(loadButton).toBeTruthy()
    act(() => loadButton?.click())
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    await settle()
    // La llamada 0 es el precargado del splash (SessionProvider); las 2 siguientes
    // son la paginación real del encuadre pedido acá.
    expect(ipc.fetchGisLayers).toHaveBeenCalledTimes(3)
    expect(ipc.fetchGisLayers.mock.calls[2]?.[0].layers).toEqual(["suministros"])

    // Volver al mismo encuadre reutiliza la cobertura y no consulta IPC.
    act(() => loadButton?.click())
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    await settle()
    expect(ipc.fetchGisLayers).toHaveBeenCalledTimes(3)
  })

  it("lista los distritos y expone solo las capas por defecto", async () => {
    await render()

    const districtCombobox = document.querySelector('input[role="combobox"]') as HTMLInputElement
    act(() => districtCombobox.focus())
    const districtOptionTexts = [...document.querySelectorAll('ul[role="listbox"] li button')]
      .map((node) => node.textContent?.replace(/\s+/g, "").trim())
    expect(districtOptionTexts).toEqual(["Todoslosdistritos", "001Lima123", "002Ancón8"])
    act(() => districtCombobox.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })))

    // "Distritos" sí se expone: el enfoque de cámara y el atenuado del resto del
    // mapa dependen de que esa capa esté activa por defecto.
    expect(document.body.textContent).toContain("Distritos")
    expect(document.body.textContent).not.toContain("Cuadrantes")
    expect(document.body.textContent).not.toContain("Alcantarillado")
  })

  it("selecciona un lote, mueve su geometría y salta a la manzana", async () => {
    await render()

    act(() => findButton("Seleccionar lote")?.click())
    expect(document.body.textContent).toContain("Lote catastral")
    expect(document.body.textContent).toContain("1345763")
    expect(document.body.textContent).toContain("010001330100")

    const adjustButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Mover solo lote"))
    act(() => adjustButton?.click())
    const nudgeEastButton = document.querySelector('button[aria-label="Mover 0.5 metros al este"]') as HTMLButtonElement | null
    act(() => nudgeEastButton?.click())
    expect(document.body.textContent).toContain("0.50 m")

    act(() => findButton("Mover geometría")?.click())
    await settle()
    const saveButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Aplicar posición"))
    await act(async () => saveButton?.click())
    await settle()
    expect(ipc.saveGeometryCorrection).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: "lot", targetId: "l-1", deltaLng: 0.0001, deltaLat: -0.0002,
    }))

    const moveBlockButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Mover manzana completa"))
    await act(async () => moveBlockButton?.click())
    await settle()
    expect(ipc.searchCadastre).toHaveBeenCalledWith("29849")
    expect(document.body.textContent).toContain("Manzana catastral")
  })

  it("busca en catastro desde la barra del mapa y selecciona el resultado", async () => {
    await render()

    const cadastralInput = document.querySelector('input[placeholder="Buscar lote o manzana"]') as HTMLInputElement
    setInputValue(cadastralInput, "1400279")
    await act(async () => {
      cadastralInput.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await settle()
    expect(ipc.searchCadastre).toHaveBeenCalledWith("1400279")

    const searchResult = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Mz 30963"))
    act(() => searchResult?.click())
    expect(document.body.textContent).toMatch(/120[.,]5 m²/)
  })

  it("busca un suministro, muestra su ficha y no repite la consulta ya cacheada", async () => {
    await render()

    const searchInput = document.querySelector('input[placeholder="Buscar suministro"]') as HTMLInputElement
    setInputValue(searchInput, "100001")
    await act(async () => findButton("Buscar")?.click())
    await settle()
    await settle()

    expect(ipc.getSupplyDetail).toHaveBeenCalledWith("100001")
    expect(document.body.textContent).toContain("Cliente prueba")
    expect(document.body.textContent).toContain("M-1")
    expect(document.body.textContent).toContain("Catastro comercial")
    expect(document.body.textContent).toContain("0200 · SERVICIO DOMESTICO")
    expect(document.body.textContent).toContain("Geometría vinculada")
    expect(ipc.fetchGisLayers.mock.calls.at(-1)?.[0].district).toBeUndefined()

    // Fuera de Tauri el botón cae a window.open en vez de abrir una ventana propia.
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    const satelliteButton = document.querySelector('button[aria-label="Abrir vista satélite en Google Maps"]') as HTMLButtonElement | null
    expect(satelliteButton).toBeTruthy()
    act(() => satelliteButton?.click())
    expect(windowOpenSpy).toHaveBeenCalledWith(expect.stringContaining("https://www.google.com/maps/"), "_blank", "noopener,noreferrer")
    windowOpenSpy.mockRestore()

    const callsBeforeRepeat = ipc.getSupplyDetail.mock.calls.length
    await act(async () => findButton("Seleccionar suministro")?.click())
    await settle()
    expect(ipc.getSupplyDetail.mock.calls.length).toBe(callsBeforeRepeat)
  })

  it("alterna la vista 3D desde la barra del mapa", async () => {
    await render()

    const threeDimensionalButton = findButton("3D")
    expect(threeDimensionalButton?.getAttribute("aria-pressed")).toBe("false")
    act(() => threeDimensionalButton?.click())
    expect(threeDimensionalButton?.getAttribute("aria-pressed")).toBe("true")
  })

  it("navega entre rutas manteniendo el mapa montado", async () => {
    await render()
    expect(findButton("Cargar BBOX")).toBeTruthy()

    const alertsLink = document.querySelector('a[href="/analisis/alertas"]') as HTMLAnchorElement
    expect(alertsLink).toBeTruthy()
    await act(async () => alertsLink.click())
    await settle()

    expect(document.body.textContent).toContain("No hay caídas abruptas detectadas")
    // La capa del mapa sigue montada (oculta con `visibility`), así que la
    // cámara y los tiles sobreviven a la navegación.
    expect(findButton("Cargar BBOX")).toBeTruthy()
    const mapLayer = findButton("Cargar BBOX")?.closest("[inert]")
    expect(mapLayer).toBeTruthy()

    const mapLink = document.querySelector('a[href="/mapa"]') as HTMLAnchorElement
    await act(async () => mapLink.click())
    await settle()
    expect(document.querySelector('input[placeholder="Buscar suministro"]')).toBeTruthy()
  })
})
