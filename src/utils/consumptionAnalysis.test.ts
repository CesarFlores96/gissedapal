import { describe, expect, it } from "vitest"

import type { ReportEvolutionRow, SupplyReport } from "../types"
import { buildConsumptionTimeline } from "./consumptionAnalysis"

const PAST_YEAR = 2024

function row(month: number, overrides: Partial<ReportEvolutionRow> = {}): ReportEvolutionRow {
  return {
    year: PAST_YEAR,
    month,
    label: `Mes ${month}`,
    currentVolume: 20,
    previousVolume: 20,
    historicalMedian: 20,
    variationVsMedianPercent: 0,
    variationVsPreviousYearPercent: 0,
    previousYearDifference: 0,
    absoluteDifference: 0,
    isAnomaly: false,
    severity: "normal",
    type: "regular",
    baselineYears: [],
    baselineValues: [],
    baselineSampleCount: 0,
    ...overrides,
  }
}

function details(overrides: Partial<SupplyReport["details"]> = {}): SupplyReport["details"] {
  return {
    stateReadings: [],
    meterInstallations: [],
    workOrders: [],
    billing: [],
    anomalies: [],
    inspections: [],
    ...overrides,
  }
}

describe("buildConsumptionTimeline", () => {
  it("devuelve un punto por cada mes, no solo por los meses anómalos", () => {
    const entries = buildConsumptionTimeline(PAST_YEAR, [row(1), row(2, { currentVolume: 0 })], details())
    expect(entries).toHaveLength(2)
    expect(entries[0].status).toBe("normal")
    expect(entries[1].status).toBe("zero")
    expect(entries[0].suggestion).toBeNull()
    expect(entries[1].suggestion).not.toBeNull()
  })

  it("clasifica alzas y bajas contra la mediana histórica", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [row(1, { currentVolume: 5 }), row(2, { currentVolume: 60 }), row(3, { currentVolume: null })],
      details(),
    )
    expect(entries.map((entry) => entry.status)).toEqual(["low", "high", "missing"])
  })

  it("ancla supervisiones y planillas al mes en que ocurrieron", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [row(5, { currentVolume: 0 })],
      details({
        supervisions: [{
          workOrderNumber: "808250892", typology: "TO153", visitDate: `${PAST_YEAR}-05-14`,
          resolutionDate: null, status: "completed", completedAt: null, createdAt: null,
          supervisor: "J. Perez", generalObservation: "Medidor parado", observation: null,
          fieldObservation: null, meterSerial: "DB24118711", readingValue: "120",
          supplyStatus: null, serviceStatus: null, meterIncident: null, clandestineStatus: null,
          clandestineDetail: null, impossibility: null, noEntryReason: null,
          inspectionPerformed: null, propertyAccess: null, propertyLocation: null,
          boxLeak: null, boxState: null, lidState: null, seal: null,
        }],
        planillas: [{
          recordDate: `${PAST_YEAR}-05-02`, meterSerial: "DB24118711", readingValue: "118",
          routeCode: "R1", itineraryCode: "I1", cycleCode: "C1", supervisor: "M. Diaz",
          requestingArea: "Control de pérdidas", load: "Carga 3", observation: "Predio cerrado",
          customerName: null, address: null, district: null, status: "completed", completedAt: null,
        }],
      }),
    )

    const categories = entries[0].evidence.map((item) => item.category)
    expect(categories).toContain("supervision")
    expect(categories).toContain("planilla")
    expect(entries[0].monthEvidenceCount).toBe(2)
    // La supervisión reporta el medidor parado: manda sobre el resto de heurísticas.
    expect(entries[0].suggestion).toContain("inoperativo")
  })

  it("arrastra órdenes de trabajo y contrastaciones de meses previos dentro de su ventana", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [row(8, { currentVolume: 0 })],
      details({
        workOrders: [
          { code: "OT-1", orderType: "corte", status: "completada", priority: "alta",
            scheduledDate: `${PAST_YEAR}-05-01`, completedAt: `${PAST_YEAR}-05-03`,
            title: "Corte de servicio", description: null, resultNotes: null },
          { code: "OT-2", orderType: "mantenimiento", status: "completada", priority: "baja",
            scheduledDate: `${PAST_YEAR - 2}-01-01`, completedAt: `${PAST_YEAR - 2}-01-05`,
            title: "Orden antigua", description: null, resultNotes: null },
        ],
        contrastations: [{
          testDate: `${PAST_YEAR}-07-10`, scheduledDate: null, claimDate: null, returnDate: null,
          orderNumber: "9001", contrastationType: "Contrastación en laboratorio", testType: null,
          status: null, result: "Dentro de tolerancia", meterSerial: "DB24118711", brand: null,
          diameterMm: 15, relativeErrorPermanent: 1.2, relativeErrorTransition: null,
          relativeErrorMinimum: null, reportNumber: null, claimCode: null, observation: null,
        }],
      }),
    )

    const titles = entries[0].evidence.map((item) => item.title)
    expect(titles).toContain("Corte de servicio")
    expect(titles).toContain("Dentro de tolerancia")
    // Fuera de la ventana de 6 meses de una orden de trabajo.
    expect(titles).not.toContain("Orden antigua")
  })

  it("mantiene el medidor vigente como contexto de fondo aunque sea muy anterior", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [row(11, { currentVolume: 0 })],
      details({
        meterInstallations: [{
          installationDate: `${PAST_YEAR - 3}-09-04`, processDate: null, meterSerial: "DB24118711",
          previousMeterSerial: null, diameterMm: 15, status: "Estado 1", workOrderNumber: null,
          serviceOrderNumber: null, currentReading: 0, previousReading: null, observation: null,
        }],
      }),
    )

    const background = entries[0].evidence.filter((item) => item.relevance === "background")
    expect(background).toHaveLength(1)
    expect(background[0].title).toContain("DB24118711")
    expect(entries[0].monthEvidenceCount).toBe(0)
    // El medidor vigente es contexto, no causa: no puede activar la sugerencia
    // de "cambio de medidor" en un mes tres años posterior a la instalación.
    expect(entries[0].suggestion).not.toContain("lectura inicial del nuevo equipo")
    expect(entries[0].suggestion).toContain("estado vigente del parque")
  })

  it("no repite la misma sugerencia en todos los meses por el medidor vigente", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [
        row(2, { currentVolume: 0 }),
        row(7, { currentVolume: 0 }),
        row(11, { currentVolume: null }),
      ],
      details({
        // Único registro del suministro: instalado mucho antes del período.
        meterInstallations: [{
          installationDate: `${PAST_YEAR - 1}-09-04`, processDate: null, meterSerial: "DB24118711",
          previousMeterSerial: null, diameterMm: 15, status: "Estado 1", workOrderNumber: null,
          serviceOrderNumber: null, currentReading: 0, previousReading: null, observation: null,
        }],
        inspections: [{
          inspectionDate: `${PAST_YEAR}-07-08`, visitDate: `${PAST_YEAR}-07-08`, workOrderNumber: "1",
          typology: "Interna", result: "Predio deshabitado", serviceStatus: "Activo",
          meterSerial: "DB24118711", readingValue: "0", observation: null,
        }],
      }),
    )

    const suggestions = entries.map((entry) => entry.suggestion)
    expect(new Set(suggestions).size).toBe(3)
    // Febrero cae dentro de la ventana de 6 meses de la instalación.
    expect(suggestions[0]).toContain("lectura inicial del nuevo equipo")
    expect(suggestions[1]).toContain("desocupado o deshabitado")
    expect(suggestions[2]).toContain("No hay lectura facturada")
  })

  it("no busca causas para períodos que aún no han sido facturados", () => {
    const nextYear = new Date().getFullYear() + 1
    const future = { ...row(6, { currentVolume: null }), year: nextYear }
    const entries = buildConsumptionTimeline(nextYear, [future], details())
    expect(entries[0].status).toBe("future")
    expect(entries[0].needsExplanation).toBe(false)
    expect(entries[0].evidence).toHaveLength(0)
  })

  it("descarta lecturas sin observación ni incidencia para no llenar el detalle de ruido", () => {
    const entries = buildConsumptionTimeline(
      PAST_YEAR,
      [row(3, { currentVolume: 0 })],
      details({
        readings: [
          { readingDate: `${PAST_YEAR}-03-10`, readingYear: PAST_YEAR, readingMonth: 3,
            meterSerial: "X", previousReading: "10", currentReading: "10",
            readingObservation: null, incidenceCode1: null, incidenceDetail1: null,
            incidenceCode2: null, incidenceDetail2: null, tariffLabel: null,
            routeCode: null, readerCode: null },
          { readingDate: `${PAST_YEAR}-03-11`, readingYear: PAST_YEAR, readingMonth: 3,
            meterSerial: "X", previousReading: "10", currentReading: "10",
            readingObservation: "Predio inaccesible", incidenceCode1: null, incidenceDetail1: null,
            incidenceCode2: null, incidenceDetail2: null, tariffLabel: null,
            routeCode: null, readerCode: null },
        ],
      }),
    )

    const readings = entries[0].evidence.filter((item) => item.category === "reading")
    expect(readings).toHaveLength(1)
    expect(readings[0].title).toBe("Predio inaccesible")
    expect(entries[0].suggestion).toContain("acceso al predio")
  })
})
