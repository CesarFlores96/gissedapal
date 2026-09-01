import { describe, expect, it } from "vitest"

import type { SupervisionEvidenceItem } from "../types"
import {
  buildEvidenceGroups,
  evidenceGroupLabel,
  evidenceGroupSortKey,
  formatEvidenceCapturedAt,
} from "./supervisionEvidence"

function item(overrides: Partial<SupervisionEvidenceItem> = {}): SupervisionEvidenceItem {
  return {
    id: "1",
    mediaType: "photo",
    mediaPath: "/uploads/supervision-media/Agosto_2026/04_08_2026/005588_1.jpg",
    mimeType: "image/jpeg",
    description: null,
    capturedAt: "2026-08-04T15:22:00+00:00",
    latitude: null,
    longitude: null,
    workOrderNumber: "12345",
    source: "supervision",
    label: null,
    supervisor: null,
    folder: "Agosto_2026",
    day: "04_08_2026",
    ...overrides,
  }
}

describe("evidenceGroupLabel", () => {
  it("humaniza la carpeta de mes y el día", () => {
    expect(evidenceGroupLabel("Agosto_2026", "folder")).toBe("Agosto 2026")
    expect(evidenceGroupLabel("04_08_2026", "day")).toBe("04/08/2026")
  })

  it("nombra la evidencia sin fecha de archivo", () => {
    expect(evidenceGroupLabel("Sin_fecha", "day")).toBe("Sin fecha de archivo")
  })
})

describe("evidenceGroupSortKey", () => {
  it("ordena los meses cronológicamente, no alfabéticamente", () => {
    // Alfabéticamente "Agosto" precede a "Diciembre"; cronológicamente no.
    expect(evidenceGroupSortKey("Diciembre_2026", "folder") > evidenceGroupSortKey("Agosto_2026", "folder")).toBe(true)
    expect(evidenceGroupSortKey("Enero_2027", "folder") > evidenceGroupSortKey("Diciembre_2026", "folder")).toBe(true)
  })

  it("ordena los días por año, mes y día", () => {
    expect(evidenceGroupSortKey("04_08_2026", "day") > evidenceGroupSortKey("28_07_2026", "day")).toBe(true)
  })
})

describe("buildEvidenceGroups", () => {
  const items = [
    item({ id: "1", day: "04_08_2026", folder: "Agosto_2026", supervisor: "J. Perez" }),
    item({ id: "2", day: "04_08_2026", folder: "Agosto_2026", mediaType: "video", supervisor: "J. Perez" }),
    item({ id: "3", day: "28_07_2026", folder: "Julio_2026", workOrderNumber: "999", supervisor: "M. Diaz" }),
    item({ id: "4", day: "12_08_2026", folder: "Agosto_2026", workOrderNumber: "777", supervisor: null }),
  ]

  it("agrupa por día y cuenta fotos y videos por separado", () => {
    const groups = buildEvidenceGroups(items, "day")

    expect(groups.map((group) => group.key)).toEqual(["12_08_2026", "04_08_2026", "28_07_2026"])
    const agosto4 = groups.find((group) => group.key === "04_08_2026")
    expect(agosto4?.photos).toBe(1)
    expect(agosto4?.videos).toBe(1)
    expect(agosto4?.supervisors).toEqual(["J. Perez"])
    expect(agosto4?.workOrders).toEqual(["12345"])
  })

  it("agrupa por carpeta juntando todos los días del mes", () => {
    const groups = buildEvidenceGroups(items, "folder")

    expect(groups.map((group) => group.key)).toEqual(["Agosto_2026", "Julio_2026"])
    expect(groups[0].items).toHaveLength(3)
    expect(groups[0].workOrders).toEqual(["12345", "777"])
  })

  it("mantiene visible la evidencia sin fecha de archivo", () => {
    const groups = buildEvidenceGroups(
      [...items, item({ id: "5", day: "Sin_fecha", folder: "Sin_fecha" })],
      "day",
    )

    expect(groups.at(-1)?.key).toBe("Sin_fecha")
    expect(groups.flatMap((group) => group.items)).toHaveLength(5)
  })

  it("no pierde ningún elemento al reagrupar", () => {
    const byDay = buildEvidenceGroups(items, "day").flatMap((group) => group.items)
    const byFolder = buildEvidenceGroups(items, "folder").flatMap((group) => group.items)

    expect(byDay).toHaveLength(items.length)
    expect(new Set(byFolder.map((entry) => entry.id))).toEqual(new Set(items.map((entry) => entry.id)))
  })
})

describe("formatEvidenceCapturedAt", () => {
  it("describe la evidencia sin fecha de captura", () => {
    expect(formatEvidenceCapturedAt(null)).toBe("Sin fecha de captura")
  })

  it("devuelve el valor crudo si no es una fecha válida", () => {
    expect(formatEvidenceCapturedAt("no-es-fecha")).toBe("no-es-fecha")
  })
})
