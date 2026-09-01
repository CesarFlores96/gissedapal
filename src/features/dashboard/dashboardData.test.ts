import { describe, expect, it } from "vitest"

import type { DashboardBilledVolumeRow, DashboardCustomerRow, DashboardPaymentRow } from "../../types"
import {
  buildAnnualVolumeRows, buildCustomers, buildMonthlyVolumeRows, buildPaymentRecordRows,
  buildShareRows, parseMoney, paymentYearsOf, truncateLabel,
} from "./dashboardData"

function customer(overrides: Partial<DashboardCustomerRow>): DashboardCustomerRow {
  return {
    customer_code: "C1", customer_id: "1", customer_name: "CLIENTE UNO", district: "LIMA",
    last_payment_date: null, payer_classification: "Buen pagador", phone_mobile: null,
    segment_name: "Grandes Clientes", supply_code: "100001", supply_debt_soles: "0",
    ...overrides,
  }
}

function volumeRow(overrides: Partial<DashboardBilledVolumeRow>): DashboardBilledVolumeRow {
  return { customer_category: "Grandes Clientes", period_month: 1, period_year: 2025, total_volume_m3: "0", ...overrides }
}

describe("parseMoney", () => {
  it("acepta los numeric de Postgres serializados como texto", () => {
    expect(parseMoney("1234.50")).toBe(1234.5)
    expect(parseMoney("S/ 1,200")).toBe(1200)
    expect(parseMoney(null)).toBe(0)
    expect(parseMoney(Number.NaN)).toBe(0)
  })
})

describe("buildCustomers", () => {
  it("agrupa suministros por cliente y suma su deuda", () => {
    const rows = [
      customer({ supply_code: "100001", supply_debt_soles: "500" }),
      customer({ supply_code: "100002", supply_debt_soles: "250.5" }),
    ]
    const [result] = buildCustomers(rows)
    expect(result.supplyCount).toBe(2)
    expect(result.totalDebt).toBe(750.5)
  })

  it("se queda con la peor clasificación de pago del grupo", () => {
    const rows = [
      customer({ payer_classification: "Buen pagador", supply_code: "100001" }),
      customer({ payer_classification: "Mal pagador", supply_code: "100002" }),
      customer({ payer_classification: "Regular", supply_code: "100003" }),
    ]
    expect(buildCustomers(rows)[0].classification).toBe("Mal pagador")
  })

  it("excluye los suministros de la propia SEDAPAL", () => {
    const rows = [
      customer({ customer_id: "2", customer_name: "SEDAPAL SEDE CENTRAL", supply_debt_soles: "9999" }),
      customer({ customer_id: "3", customer_name: "CLIENTE REAL", supply_debt_soles: "10" }),
    ]
    const result = buildCustomers(rows)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("CLIENTE REAL")
  })

  it("ordena de mayor a menor deuda", () => {
    const rows = [
      customer({ customer_id: "a", customer_name: "A", supply_debt_soles: "10" }),
      customer({ customer_id: "b", customer_name: "B", supply_debt_soles: "900" }),
    ]
    expect(buildCustomers(rows).map((row) => row.name)).toEqual(["B", "A"])
  })
})

describe("series de volumen", () => {
  it("separa Fuente Propia de Grandes Clientes y acumula el total anual", () => {
    const rows = [
      volumeRow({ customer_category: "Fuente Propia", total_volume_m3: "100" }),
      volumeRow({ customer_category: "Grandes Clientes", total_volume_m3: "300" }),
      volumeRow({ customer_category: "Grandes Clientes", period_year: 2024, total_volume_m3: "50" }),
    ]
    const annual = buildAnnualVolumeRows(rows)
    expect(annual.map((row) => row.periodYear)).toEqual([2024, 2025])
    expect(annual[1]).toMatchObject({ fuentePropia: 100, grandesClientes: 300, total: 400 })
  })

  it("devuelve solo los meses con datos del año pedido", () => {
    const rows = [
      volumeRow({ period_month: 3, total_volume_m3: "80" }),
      volumeRow({ period_month: 7, total_volume_m3: "20" }),
      volumeRow({ period_month: 7, period_year: 2024, total_volume_m3: "999" }),
    ]
    const monthly = buildMonthlyVolumeRows(rows, 2025)
    expect(monthly.map((row) => row.label)).toEqual(["Mar", "Jul"])
    expect(monthly[0].total).toBe(80)
  })

  it("sin año seleccionado no devuelve detalle mensual", () => {
    expect(buildMonthlyVolumeRows([volumeRow({})], null)).toEqual([])
  })
})

describe("registro de pagos", () => {
  const payments: DashboardPaymentRow[] = [
    { amount_soles: "1000", payment_date: "2025-01-15" },
    { amount_soles: "500", payment_date: "2025-01-20" },
    { amount_soles: "300", payment_date: "2024-06-01" },
    { amount_soles: "100", payment_date: null },
  ]

  it("lista los años presentes, del más reciente al más antiguo", () => {
    expect(paymentYearsOf(payments)).toEqual([2025, 2024])
  })

  it("suma por mes y rellena los doce meses del año elegido", () => {
    const rows = buildPaymentRecordRows(payments, 2025)
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({ actual: 1500, label: "Ene" })
    expect(rows[5].actual).toBe(0)
    // La banda de referencia nunca queda por debajo del propio mes.
    expect(rows[0].target).toBeGreaterThanOrEqual(rows[0].actual)
  })
})

describe("utilidades de presentación", () => {
  it("cicla la paleta cuando hay más filas que colores", () => {
    const rows = [{ label: "A", total: 1 }, { label: "B", total: 2 }, { label: "C", total: 3 }]
    expect(buildShareRows(rows, ["#111", "#222"]).map((row) => row.color)).toEqual(["#111", "#222", "#111"])
  })

  it("recorta etiquetas largas sin cortar las que ya caben", () => {
    expect(truncateLabel("CLIENTE", 10)).toBe("CLIENTE")
    expect(truncateLabel("CLIENTE MUY LARGO SA", 10)).toBe("CLIENTE M…")
  })
})
