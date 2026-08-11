import { describe, expect, it, vi } from "vitest"

const ipc = vi.hoisted(() => ({
  getSupplyReportHeader: vi.fn(),
  getSupplyReportTemporal: vi.fn(),
  getSupplyReportDetails: vi.fn(),
  getSupplyReportSpatial: vi.fn(),
}))

vi.mock("../../lib/ipc", () => ipc)

import { preloadSupplyReport } from "./supplyReportCache"

describe("supplyReportCache", () => {
  it("precarga una sola cadena y mantiene el orden de bloques", async () => {
    const calls: string[] = []
    ipc.getSupplyReportHeader.mockImplementation(async () => { calls.push("header"); return { customerName: "Cliente", district: null, classification: "Operativo", payerClassification: "Regular", serviceStatus: "Activo", debt: 0 } })
    ipc.getSupplyReportTemporal.mockImplementation(async () => { calls.push("temporal"); return { supplyCode: "serial", years: [], analysisByYear: {}, billing: [], generatedAt: null } })
    ipc.getSupplyReportDetails.mockImplementation(async () => { calls.push("details"); return { stateReadings: [], meterInstallations: [], workOrders: [], billing: [], anomalies: [], inspections: [] } })
    ipc.getSupplyReportSpatial.mockImplementation(async () => { calls.push("spatial"); return { coverage: {}, spatial: {}, economic: {}, operations: {} } })

    const first = preloadSupplyReport("serial")
    const second = preloadSupplyReport("serial")
    expect(second).toBe(first)
    await first

    expect(calls).toEqual(["header", "temporal", "details", "spatial"])
    expect(ipc.getSupplyReportHeader).toHaveBeenCalledTimes(1)
    expect(ipc.getSupplyReportTemporal).toHaveBeenCalledTimes(1)
    expect(ipc.getSupplyReportDetails).toHaveBeenCalledTimes(1)
    expect(ipc.getSupplyReportSpatial).toHaveBeenCalledTimes(1)
  })
})
