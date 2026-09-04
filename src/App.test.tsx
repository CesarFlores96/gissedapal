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
  fetchCacheRevisions: vi.fn().mockResolvedValue({ revisions: {}, pollAfterSeconds: 15 }),
  fetchGisLayers: vi.fn(),
  fetchDistricts: vi.fn(),
  getAbruptConsumptionDrops: vi.fn(),
  getClientLotReport: vi.fn(),
  getDashboard: vi.fn(),
  getSession: vi.fn(),
  getReportsMaster: vi.fn(),
  getSupplyDetail: vi.fn(),
  getSupplyConsumption: vi.fn(),
  getSupplyReport: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  relaunchApp: vi.fn(),
  resolveLocation: vi.fn(),
  resolvePlace: vi.fn(),
  saveGeometryCorrection: vi.fn(),
  searchCadastre: vi.fn(),
  searchPlaces: vi.fn(),
}))

vi.mock("./lib/ipc", () => ipc)
vi.mock("./features/map/lotContext", () => ({ getTileServerUrl: vi.fn().mockResolvedValue("http://127.0.0.1:0") }))
vi.mock("./components/MapView", () => ({
  MapView: ({ adjustmentMode, focusedSupplyGroup, onAdjustmentDeltaChange, onBoundsChange, onCadastralSelect, onSupplySelect, selectionFocusBehavior }: {
    adjustmentMode: boolean
    focusedSupplyGroup?: Array<{ supplyCode: string }>
    onAdjustmentDeltaChange: (delta: { lng: number; lat: number }) => void
    onBoundsChange: (bbox: [number, number, number, number], zoom: number) => void
    onCadastralSelect: (selection: { id: string; kind: "lot" | "block"; properties: Record<string, unknown> }) => void
    onSupplySelect: (code: string) => void
    selectionFocusBehavior: "auto" | "preserve"
  }) => (
    <div>
      <button onClick={() => onBoundsChange([-77.2, -12.2, -76.9, -11.9], 16)} type="button">Cargar BBOX</button>
      <button onClick={() => onCadastralSelect({ id: "l-1", kind: "lot", properties: { district: "EL AGUSTINO", district_code: "010", block_code: "29849", lot_code: "1345763", cup_code: "010001330100", property_code: "10", lot_type_code: "TL001" } })} type="button">Seleccionar lote</button>
      <button onClick={() => onCadastralSelect({ id: "b-1", kind: "block", properties: { district: "EL AGUSTINO", district_code: "010", block_code: "29849" } })} type="button">Seleccionar manzana</button>
      <button onClick={() => onSupplySelect("100001")} type="button">Seleccionar suministro</button>
      <span data-testid="selection-focus">{selectionFocusBehavior}</span>
      <output data-testid="focused-group">{focusedSupplyGroup?.map((point) => point.supplyCode).join(",")}</output>
      {adjustmentMode ? <button onClick={() => onAdjustmentDeltaChange({ lng: 0.0001, lat: -0.0002 })} type="button">Mover geometría</button> : null}
    </div>
  ),
}))
vi.mock("./components/AlertsMap", () => ({
  AlertsMap: ({ alerts, selectedAlert }: {
    alerts: Array<{
      supplyCode: string
      supplyPoints?: Array<{ supplyCode: string; geometry: unknown }>
      geometry?: unknown
    }>
    selectedAlert: { supplyCode: string } | null
  }) => {
    const locatedCodes = alerts.flatMap((alert) => {
      if (alert.supplyPoints?.length) {
        return alert.supplyPoints.filter((point) => point.geometry).map((point) => point.supplyCode)
      }
      return alert.geometry ? [alert.supplyCode] : []
    })
    return (
      <div data-testid="alerts-map">
        <output data-testid="alert-map-located-codes">{locatedCodes.join(",")}</output>
        <output data-testid="alert-map-selected">{selectedAlert?.supplyCode ?? ""}</output>
      </div>
    )
  },
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
  await act(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  })
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
  async function render(initialEntry = "/mapa") {
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await settle()
    return router
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
    ipc.fetchCacheRevisions.mockResolvedValue({ revisions: {}, pollAfterSeconds: 15 })
    ipc.getSession.mockResolvedValue({ authenticated: true, user: { id: "u1", email: "gis@sedapal.test" } })
    ipc.fetchGisLayers.mockImplementation(({ page }: { page: number }) => Promise.resolve(layerResponse(page, page === 1)))
    ipc.fetchDistricts.mockResolvedValue([
      { code: "002", name: "Ancón", supplyCount: 8, bounds: [-77.2, -11.8, -77.0, -11.6], center: [-77.1, -11.7] },
      { code: "001", name: "Lima", supplyCount: 123, bounds: [-77.1, -12.1, -77.0, -12.0], center: [-77.05, -12.05] },
    ])
    ipc.getSupplyDetail.mockResolvedValue(detail)
    ipc.getSupplyConsumption.mockResolvedValue(null)
    ipc.getAbruptConsumptionDrops.mockResolvedValue({ total: 0, items: [] })
    ipc.getClientLotReport.mockResolvedValue({
      supplyCode: "cup:003000470430",
      years: [],
      header: {
        customerName: "DIRECCION DE REDES INTEGRADAS DE SALUD LIMA ESTE",
        district: "ATE",
        classification: "Grandes Clientes",
        payerClassification: "Regular",
        serviceStatus: "Activo",
        debt: 0,
      },
      analysisByYear: {},
      group: {
        analysisScope: "property",
        propertyCode: "cup:003000470430",
        supplyCodes: ["4127147", "6247075", "6247076", "6247077", "6247078"],
        supplyCount: 5,
      },
      generatedAt: null,
    })
    ipc.getReportsMaster.mockResolvedValue({ data: [], page: 1, pageSize: 25, total: 0, summary: { fuentePropiaDebt: 0, grandesClientesDebt: 0, totalDebt: 0 } })
    ipc.getDashboard.mockResolvedValue({
      billedAmountProjection: [],
      billedVolumeProjection: [],
      customers: [
        { customer_code: "C1", customer_id: "1", customer_name: "CLIENTE CRITICO S.A.", district: "ATE",
          last_payment_date: null, payer_classification: "Mal pagador", phone_mobile: null,
          segment_name: "Grandes Clientes", supply_code: "100001", supply_debt_soles: "12000" },
      ],
      debtAnalytics: { ageRanges: [], officeTotals: [], tariffTotals: [], topUses: [], zoneTotals: [] },
      fpDebtSummary: {
        customerCount: "1",
        snapshotTotalDebt: "12000",
        topDebtors: [{ customer_name: "CLIENTE CRITICO S.A.", customer_code: "C1", district: "ATE",
          segment_name: "Grandes Clientes", total_debt: "12000" }],
      },
      monthlyPayments: [],
      paymentSummary: {
        offices: [], tariffs: [], topPayers: [],
        totals: { matched_payment_count: "4", payment_count: "5", total_amount: "9000", unmatched_payment_count: "1" },
      },
    })
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
    // Sin precarga en el splash: ambas llamadas son la paginación real del encuadre.
    expect(ipc.fetchGisLayers).toHaveBeenCalledTimes(2)
    expect(ipc.fetchGisLayers.mock.calls[1]?.[0].layers).toEqual(["suministros"])

    // Volver al mismo encuadre reutiliza la cobertura y no consulta IPC.
    act(() => loadButton?.click())
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    await settle()
    expect(ipc.fetchGisLayers).toHaveBeenCalledTimes(2)
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
    expect(document.querySelector('[data-testid="selection-focus"]')?.textContent).toBe("preserve")
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
    expect(document.querySelector('[data-testid="selection-focus"]')?.textContent).toBe("preserve")
  })

  it("mantiene la cámara actual al seleccionar otra manzana directamente en el mapa", async () => {
    await render()

    act(() => findButton("Seleccionar lote")?.click())
    expect(document.querySelector('[data-testid="selection-focus"]')?.textContent).toBe("preserve")

    act(() => findButton("Seleccionar manzana")?.click())
    expect(document.querySelector('[data-testid="selection-focus"]')?.textContent).toBe("preserve")
    expect(document.body.textContent).toContain("Manzana catastral")
  })

  it("busca en catastro desde la barra del mapa y selecciona el resultado", async () => {
    await render()

    const cadastralInput = document.querySelector('input[placeholder="Lote o manzana"]') as HTMLInputElement
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

    const searchInput = document.querySelector('input[placeholder="Suministro o NIS"]') as HTMLInputElement
    setInputValue(searchInput, "100001")
    await act(async () => findButton("Buscar")?.click())
    await settle()
    await settle()

    expect(ipc.getSupplyDetail).toHaveBeenCalledWith("100001")
    expect(document.body.textContent).toContain("Cliente prueba")
    expect(document.body.textContent).toContain("M-1")
    expect(document.body.textContent).toContain("Catastro comercial")
    expect(document.body.textContent).toContain("0200 · SERVICIO DOMESTICO")
    expect(document.body.textContent).toContain("Ubicación")
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

  it("busca un lugar en el mapa con autocompletado y lo centra al elegirlo", async () => {
    ipc.searchPlaces.mockResolvedValue([
      { label: "Metro Brena H, Avenida Alfonso Ugarte 6, Lima, PER", placeId: "place-1" },
      { label: "Metro Plaza Castilla, Jirón Oroya, Lima, PER", placeId: "place-2" },
    ])
    ipc.resolvePlace.mockResolvedValue({ label: "Metro Brena H, Avenida Alfonso Ugarte 6, Lima, PER", lng: -77.0424, lat: -12.048 })
    await render()

    const placeInput = document.querySelector('input[placeholder="Buscar un lugar…"]') as HTMLInputElement
    expect(placeInput).toBeTruthy()
    setInputValue(placeInput, "Metro")
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    await settle()

    expect(ipc.searchPlaces).toHaveBeenCalledWith("Metro", undefined)
    const suggestion = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Metro Brena H"))
    expect(suggestion).toBeTruthy()

    await act(async () => suggestion?.click())
    await settle()
    expect(ipc.resolvePlace).toHaveBeenCalledWith("Metro Brena H, Avenida Alfonso Ugarte 6, Lima, PER", "place-1", undefined)
  })

  it("alterna la vista 3D desde la barra del mapa", async () => {
    await render()

    const threeDimensionalButton = findButton("3D")
    expect(threeDimensionalButton?.getAttribute("aria-pressed")).toBe("false")
    act(() => threeDimensionalButton?.click())
    expect(threeDimensionalButton?.getAttribute("aria-pressed")).toBe("true")
  })

  it("abre un reporte consolidado para todos los NIS del cliente y lote", async () => {
    const router = await render()
    await act(async () => {
      await router.navigate("/cliente-lote/cup%3A003000470430?nis=4127147&nis=6247075&nis=6247076&nis=6247077&nis=6247078")
    })
    await settle()

    expect(ipc.getClientLotReport).toHaveBeenCalledWith([
      "4127147", "6247075", "6247076", "6247077", "6247078",
    ])
    expect(document.body.textContent).toContain("Lote 003000470430 · 5 NIS")
    expect(document.body.textContent).toContain("6247078")
  })

  it("muestra en el mapa de alertas solo los NIS agrupados que tienen ubicación", async () => {
    ipc.getAbruptConsumptionDrops.mockResolvedValue({
      total: 1,
      items: [{
        supplyCode: "6247075",
        supplyCodes: ["4127147", "6247075", "6247076", "6247077", "6247078"],
        supplyCount: 5,
        supplyPoints: [
          { supplyCode: "4127147", geometry: { type: "Point", coordinates: [-76.93, -12.05] } },
          { supplyCode: "6247075", geometry: null },
          { supplyCode: "6247076", geometry: null },
          { supplyCode: "6247077", geometry: null },
          { supplyCode: "6247078", geometry: null },
        ],
        propertyCode: "cup:003000470430",
        customerName: "DIRECCION DE REDES INTEGRADAS DE SALUD LIMA ESTE",
        district: "ATE",
        period: "2026-07-01",
        currentVolume: 0,
        referenceVolume: 78,
        dropPercent: 100,
        kind: "zero",
        analysisScope: "property",
        classification: "Grandes Clientes",
        geometry: { type: "Point", coordinates: [-76.93, -12.05] },
      }],
    })
    await render("/analisis/alertas")
    await act(async () => findButton("Por cliente y lote")?.click())
    await act(async () => findButton("Buscar alertas")?.click())
    await settle()
    await act(async () => findButton("Ver lote en el mapa")?.click())
    await settle()

    expect(document.querySelector('[data-testid="alert-map-located-codes"]')?.textContent).toBe("4127147")
    expect(document.querySelector('[data-testid="alert-map-selected"]')?.textContent).toBe("6247075")
  })

  it("navega entre el mapa general y el mapa dedicado de Alertas", async () => {
    await render()
    expect(findButton("Cargar BBOX")).toBeTruthy()

    const alertsLink = document.querySelector('a[href="/analisis/alertas"]') as HTMLAnchorElement
    expect(alertsLink).toBeTruthy()
    await act(async () => alertsLink.click())
    await settle()

    expect(document.body.textContent).toContain("Configura los filtros para comenzar")
    await act(async () => findButton("Buscar alertas")?.click())
    await settle()
    expect(document.body.textContent).toContain("No se encontraron alertas")
    // Alertas desmonta el canvas general para no mantener dos contextos WebGL.
    expect(findButton("Cargar BBOX")).toBeFalsy()
    expect(document.querySelector('[data-testid="alerts-map"]')).toBeTruthy()

    const mapLink = document.querySelector('a[href="/mapa"]') as HTMLAnchorElement
    await act(async () => mapLink.click())
    await settle()
    expect(document.querySelector('input[placeholder="Suministro o NIS"]')).toBeTruthy()
    expect(findButton("Cargar BBOX")).toBeTruthy()
  })

  it("abre el dashboard desde el sidebar y solo pide la pestaña visible", async () => {
    await render()

    const dashboardLink = document.querySelector('a[href="/dashboard"]') as HTMLAnchorElement
    expect(dashboardLink).toBeTruthy()
    await act(async () => dashboardLink.click())
    // La ruta es `lazy`: además de los timers hay que dejar resolver el import
    // dinámico, que encadena varias rondas de microtareas antes de montar.
    for (let round = 0; round < 4; round += 1) await settle()

    expect(ipc.getDashboard).toHaveBeenCalledWith("resumen")
    expect(ipc.getDashboard).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Centro de control operativo")
    expect(document.body.textContent).toContain("CLIENTE CRITICO S.A.")

    // Distribución y volúmenes se piden al abrir su pestaña, no junto al resumen.
    const distributionTab = [...document.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent?.includes("Distribución")) as HTMLElement
    await act(async () => distributionTab.click())
    await settle()
    expect(ipc.getDashboard).toHaveBeenCalledWith("distribucion")
    expect(ipc.getDashboard).toHaveBeenCalledTimes(2)
  })
})
