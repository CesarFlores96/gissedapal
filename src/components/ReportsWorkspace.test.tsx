import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReportsWorkspace } from "./ReportsWorkspace"
import type { ReportsMasterPage, SupplyReport } from "../types"

const ipc = vi.hoisted(() => ({
  getReportsMaster: vi.fn(),
  getSupplyReport: vi.fn(),
  getSupplyReportHeader: vi.fn(),
  getSupplyReportSpatial: vi.fn(),
  getSupplyReportDetails: vi.fn(),
  getSupplyReportTemporal: vi.fn(),
}))
vi.mock("../lib/ipc", () => ipc)

const maplibre = vi.hoisted(() => {
  class FakeMaplibreMap {
    private loadCallbacks: (() => void)[] = []
    private isLoaded = false
    constructor() {
      window.setTimeout(() => { this.isLoaded = true; this.loadCallbacks.splice(0).forEach((cb) => cb()) }, 0)
    }
    on(event: string, cb: () => void): void { if (event === "load") this.loadCallbacks.push(cb) }
    once(event: string, cb: () => void): void { if (event !== "load") return; if (this.isLoaded) cb(); else this.loadCallbacks.push(cb) }
    loaded(): boolean { return this.isLoaded }
    addSource(): void {}
    addLayer(): void {}
    setFeatureState(): void {}
    remove(): void {}
  }
  class FakeMaplibreMarker {
    setLngLat(): this { return this }
    setPopup(): this { return this }
    addTo(): this { return this }
    remove(): void {}
  }
  class FakeMaplibrePopup {
    setHTML(): this { return this }
  }
  class FakeMaplibreLngLatBounds {
    extend(): this { return this }
  }
  return { Map: FakeMaplibreMap, Marker: FakeMaplibreMarker, Popup: FakeMaplibrePopup, LngLatBounds: FakeMaplibreLngLatBounds }
})
vi.mock("maplibre-gl", () => ({ default: maplibre }))

const master: ReportsMasterPage = {
  page: 1,
  pageSize: 25,
  total: 2,
  summary: { fuentePropiaDebt: 0, grandesClientesDebt: 125, totalDebt: 125 },
  data: [
    { supplyCode: "100001", customerName: "Cliente prueba", district: "Lima", debt: 125, officeName: null, segmentName: "Grandes clientes", meterSerial: null, routeCode: null, itineraryCode: null, trendPeriod: "2026-01 / 2026-06", currentVolume: 80, previousVolume: 100, trendPercent: -20, baselineMedianM3: 100, targetMedianM3: 80 },
    { supplyCode: "100002", customerName: "Cliente comparación", district: "Comas", debt: 0, officeName: null, segmentName: "Operativo", meterSerial: null, routeCode: null, itineraryCode: null, trendPeriod: "2026-01 / 2026-06", currentVolume: 95, previousVolume: 90, trendPercent: 5.6, baselineMedianM3: 90, targetMedianM3: 95 },
  ],
}

const report: SupplyReport = {
  supplyCode: "100001",
  years: [2026],
  header: { customerName: "Cliente prueba", district: "Lima", classification: "Comercial", payerClassification: "Regular", serviceStatus: "Activo", debt: 125 },
  analysisByYear: {
    "2026": {
      evolutionRows: [
        { year: 2026, month: 6, label: "Junio", currentVolume: 100, previousVolume: 90, historicalMedian: 95, variationVsMedianPercent: 5.3, variationVsPreviousYearPercent: 11.1, previousYearDifference: 10, absoluteDifference: 5, isAnomaly: false, severity: "normal", type: "normal", baselineYears: [2024, 2025], baselineValues: [90, 95], baselineSampleCount: 2 },
        { year: 2026, month: 7, label: "Julio", currentVolume: 80, previousVolume: 100, historicalMedian: 98, variationVsMedianPercent: -18.4, variationVsPreviousYearPercent: -20, previousYearDifference: -20, absoluteDifference: -18, isAnomaly: true, severity: "probable", type: "caida", baselineYears: [2024, 2025], baselineValues: [96, 100], baselineSampleCount: 2 },
      ],
      summary: { accumulatedVolume: 180, historicalAccumulatedMedian: 193, medianDeltaPercent: -6.7, medianDeltaM3: -13, previousDeltaPercent: -5, previousDeltaM3: -10, baselineStartYear: 2024, baselineEndPeriod: "2026-07" },
      insightCards: [],
      analysis: { severity: "probable", score: 70, robustZScore: -2.1, reasons: ["Caida frente a la mediana historica"] },
    },
  },
  indicators: {
    coverage: { billing: true, district: true, geolocation: true, block: true, lot: true, operations: true },
    spatial: { blockCode: "MZ-01", blockGeometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }, blockLots: [{ id: "lot-1", lotCode: "LT-01", areaM2: 200, isCurrent: true, geometry: { type: "Polygon", coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] } }, { id: "lot-2", lotCode: "LT-02", areaM2: 200, isCurrent: false, geometry: { type: "Polygon", coordinates: [[[5, 0], [10, 0], [10, 10], [5, 10], [5, 0]]] } }], districtCode: "001", hasGeolocation: true, hasLot: true, hasBlock: true, lotAreaM2: 200, lotPerimeterM: 60, blockPerimeterM: 180, blockLotAreaM2: 1000, lotLevels: 2, periodYear: 2026, periodMonth: 7, currentConsumptionM3: 80, currentBillingSoles: 240, districtAverageM3: 90, districtConsumptionM3: 9000, districtBillingSoles: 27000, districtSupplyCount: 100, districtRank: 42, consumptionPercentile: 58, blockAverageM3: 85, lotConsumptionM3: 160, lotSupplyCount: 2, blockConsumptionM3: 850, blockBillingSoles: 2550, blockSupplyCount: 10, blockRank: 5, neighborAverageM3: 88, neighborCount: 6, consumptionPerM2: 0.4, consumptionPerLinearMeter: 1.33, currentSupplyConsumptionPerM2: 0.4, currentSupplyConsumptionPerLinearMeter: 1.33, blockConsumptionDensityM3PerM2: 0.85, blockConsumptionPerLinearMeter: 4.72, neighborDeviationPercent: -9.1, districtPerAreaRank: 30, districtPerAreaSupplyCount: 100, similarLotsAverageM3: 82, similarLotsCount: 12, districtLotPeers: [], similarLots: [] },
    economic: { latestYear: 2026, latestMonth: 7, monthlyBillingSoles: 240, annualBillingSoles: 1680, averageTicketSoles: 230, billedPeriodCount: 24 },
    operations: { inspectionCount: 2, lastInspectionAt: "2026-06-01", openAnomalyCount: 1, contrastationCount: 1, lastContrastationResult: "Conforme" },
  },
  details: {
    stateReadings: [{ readingDate: "2026-07-01", readingType: "Real", meterType: "Velocimétrico", meterSerial: "M-1", diameterMm: "15", readingValue: "1200", incidenceLabel: null, incidenceDetail: null, observation: null }],
    meterInstallations: [{ installationDate: "2025-01-01", processDate: "2025-01-02", meterSerial: "M-1", previousMeterSerial: null, diameterMm: 15, status: "Activo", workOrderNumber: "OT-1", serviceOrderNumber: null, currentReading: 1200, previousReading: null, observation: null }],
    workOrders: [{ code: "OT-1", orderType: "inspeccion", status: "completada", priority: "media", scheduledDate: "2026-06-01", completedAt: "2026-06-01", title: "Inspección", description: null, resultNotes: null }],
    billing: [{ period_year: 2026, period_month: 7, concept: "consumo_agua", billed_volume_m3: 80, amount_soles: 240 }],
    anomalies: [{ anomalyType: "consumption_drop", detectedAt: "2026-07-01", detectedValue: 80, expectedValue: 98, deviationPercent: -18.4, resolved: false, resolvedAt: null, resolutionNotes: null, status: "pendiente", readingObservation: null, billingObservation: null, inspectionObservation: null }],
    inspections: [{ inspectionDate: "2026-06-01", visitDate: "2026-06-01", workOrderNumber: "OT-1", typology: "Comercial", result: "Conforme", serviceStatus: "Activo", meterSerial: "M-1", readingValue: "1180", observation: null }],
  },
  generatedAt: "2026-08-04T10:00:00Z",
}

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  })
}

describe("ReportsWorkspace MDI", () => {
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver = ResizeObserverMock
    sessionStorage.clear()
    document.body.innerHTML = '<div id="root"></div>'
    root = createRoot(document.querySelector("#root") as HTMLDivElement)
    ipc.getReportsMaster.mockResolvedValue(master)
    ipc.getSupplyReport.mockImplementation((supplyCode: string) => Promise.resolve({ ...report, supplyCode, header: { ...report.header, customerName: supplyCode === "100001" ? "Cliente prueba" : "Cliente comparación" } }))
    ipc.getSupplyReportHeader.mockImplementation((supplyCode: string) => Promise.resolve({ ...report.header, customerName: supplyCode === "100001" ? "Cliente prueba" : "Cliente comparación" }))
    ipc.getSupplyReportSpatial.mockResolvedValue(report.indicators)
    ipc.getSupplyReportDetails.mockResolvedValue(report.details)
    ipc.getSupplyReportTemporal.mockResolvedValue({ supplyCode: report.supplyCode, years: report.years, analysisByYear: report.analysisByYear, billing: report.details.billing, generatedAt: report.generatedAt })
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
  })

  it("compara documentos en tabs y muestra gráficos y tabla", async () => {
    await act(async () => root.render(<ReportsWorkspace />))
    await settle()

    const firstSupply = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("100001 · Cliente prueba"))
    const secondSupply = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("100002 · Cliente comparación"))
    await act(async () => firstSupply?.click())
    await act(async () => secondSupply?.click())
    await settle()

    const stateReadingTab = [...document.querySelectorAll('[data-family-visible="true"] [role="tab"]')].find((tab) => tab.textContent === "Toma de Estado") as HTMLElement | undefined
    act(() => stateReadingTab?.click())
    expect(stateReadingTab?.hasAttribute("data-active")).toBe(true)

    const riskTab = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Riesgo") as HTMLElement | undefined
    act(() => riskTab?.click())
    await settle()

    expect(document.querySelectorAll('[data-family-visible="true"] > section[aria-label="Indicadores de riesgo"]').length).toBe(1)
    expect(document.querySelectorAll('[data-family-visible="true"] [data-slot="chart"]').length).toBe(0)
    expect(document.querySelectorAll('[data-family-visible="true"] [role="tab"]').length).toBe(0)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(ipc.getSupplyReportHeader).toHaveBeenCalled()
    expect(ipc.getSupplyReportSpatial).toHaveBeenCalled()
    expect(ipc.getSupplyReportDetails).toHaveBeenCalled()
    expect(ipc.getSupplyReportTemporal).toHaveBeenCalled()

    const consumptionTab = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Consumo") as HTMLElement | undefined
    act(() => consumptionTab?.click())
    await settle()
    expect(document.querySelectorAll('[data-family-visible="true"] > section[aria-label="Indicadores de consumo"]').length).toBe(2)
    expect(document.querySelectorAll('[data-family-visible="true"] > section[aria-label="Indicadores de riesgo"]').length).toBe(0)
    expect(document.querySelectorAll('[data-family-visible="false"] > section[aria-label="Indicadores de riesgo"]').length).toBe(1)
    expect(stateReadingTab?.hasAttribute("data-active")).toBe(true)
    for (const label of ["Indicadores", "Evolución Volumen", "Toma de Estado", "Instalación de Medidores", "Órdenes", "Facturación", "Anomalías", "Catastro"]) {
      expect([...document.querySelectorAll('[data-family-visible="true"] [role="tab"]')].some((tab) => tab.textContent === label)).toBe(true)
    }

    const dataTabs = [...document.querySelectorAll('[data-family-visible="true"] [role="tab"]')].filter((tab) => tab.textContent === "Evolución Volumen") as HTMLElement[]
    act(() => dataTabs[0]?.click())
    const firstConsumptionPanel = dataTabs[0]?.closest("section")
    expect(firstConsumptionPanel?.querySelector('[data-slot="table"]')).toBeTruthy()
    expect(firstConsumptionPanel?.querySelector('[data-slot="chart"]')).toBeNull()
    const billingTab = [...(firstConsumptionPanel?.querySelectorAll('[role="tab"]') ?? [])].find((tab) => tab.textContent === "Facturación") as HTMLElement | undefined
    act(() => billingTab?.click())
    expect(firstConsumptionPanel?.textContent).toContain("80 m3")
    expect(firstConsumptionPanel?.textContent).toContain("240")

    act(() => (document.querySelector('button[aria-label="Expandir panel"]') as HTMLButtonElement).click())
    expect(document.querySelector('button[aria-label="Restaurar panel"]')).toBeTruthy()

    const economicTab = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Economicos") as HTMLElement | undefined
    act(() => economicTab?.click())
    await settle()
    expect(document.body.textContent).toContain("Facturacion mensual")
    expect(document.body.textContent).toContain("S/ 240")
    expect(document.querySelectorAll('[data-family-visible="true"] [role="tab"]').length).toBe(0)

    const spatialTab = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Espaciales") as HTMLElement | undefined
    act(() => spatialTab?.click())
    await settle()
    expect(document.body.textContent).toContain("0.4 m3/m2")
    expect(document.body.textContent).toContain("0.85 m3/m2")
    expect(document.body.textContent).toContain("850 m3")
    const blockButton = [...document.querySelectorAll('[data-family-visible="true"] button')].find((button) => button.textContent === "Ver manzana") as HTMLButtonElement | undefined
    act(() => blockButton?.click())
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    expect(document.querySelector('div[aria-label="Manzana MZ-01 con 2 lotes"]')).toBeTruthy()
  })

  it("aplica el porcentaje solamente al pulsar Filtrar", async () => {
    await act(async () => root.render(<ReportsWorkspace />))
    await settle()

    const lowButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Baja")
    await act(async () => lowButton?.click())
    await settle()

    const input = document.querySelector<HTMLInputElement>("#minimum-trend")
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    const callsBeforeTyping = ipc.getReportsMaster.mock.calls.length
    act(() => {
      valueSetter?.call(input, "60")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await settle()
    expect(ipc.getReportsMaster).toHaveBeenCalledTimes(callsBeforeTyping)

    const applyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Aplicar filtro porcentual"]')
    await act(async () => applyButton?.click())
    await settle()
    expect(ipc.getReportsMaster).toHaveBeenLastCalledWith(expect.objectContaining({ filterActive: true, minTrendPercent: 60, trendDirection: "decreasing" }))
  })
})
