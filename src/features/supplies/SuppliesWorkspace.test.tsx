import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"

import { SuppliesWorkspace } from "./SuppliesWorkspace"

// Global setup for DOM tests
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const maplibre = vi.hoisted(() => {
  class FakeMaplibreMap {
    on(): void {}
    addControl(): void {}
    remove(): void {}
    panTo(): void {}
  }
  class FakeMaplibreMarker {
    setLngLat(): this { return this }
    addTo(): this { return this }
    on(): void {}
    getLngLat(): { lng: number; lat: number } { return { lng: -77.04279, lat: -12.04637 } }
    remove(): void {}
  }
  class FakeMaplibreNavigationControl {}
  return {
    default: {
      Map: FakeMaplibreMap,
      Marker: FakeMaplibreMarker,
      NavigationControl: FakeMaplibreNavigationControl,
    },
    Map: FakeMaplibreMap,
    Marker: FakeMaplibreMarker,
    NavigationControl: FakeMaplibreNavigationControl,
  }
})
vi.mock("maplibre-gl", () => maplibre)

describe("SuppliesWorkspace", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    if (container) {
      container.remove()
    }
    container = null
    root = null
  })

  it("renders tabs Suministros and Medidores", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SuppliesWorkspace />
        </MemoryRouter>,
      )
    })

    expect(container?.textContent).toContain("Suministros")
    expect(container?.textContent).toContain("Medidores")
    expect(container?.textContent).toContain("UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS")
  })

  it("expands master row to show detail supplies sub-table without Ver en Mapa option", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SuppliesWorkspace />
        </MemoryRouter>,
      )
    })

    // Find the expand button for the first client row
    const firstRowButtons = container?.querySelectorAll("tbody tr td button")
    const expandBtn = firstRowButtons ? (firstRowButtons[0] as HTMLButtonElement) : null

    if (expandBtn) {
      await act(async () => {
        expandBtn.click()
      })
    }

    // Detail should reveal supply code 100001 and Ubicación button, but NOT "Ver en Mapa"
    expect(container?.textContent).toContain("100001")
    expect(container?.textContent).toContain("MED-98231")
    expect(container?.textContent).toContain("Ubicación")
    expect(container?.textContent).not.toContain("Ver en Mapa")
  })

  it("opens Ubicación modal with map and coordinates input when clicking Ubicación", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SuppliesWorkspace />
        </MemoryRouter>,
      )
    })

    // Expand client row
    const firstRowButtons = container?.querySelectorAll("tbody tr td button")
    const expandBtn = firstRowButtons ? (firstRowButtons[0] as HTMLButtonElement) : null
    if (expandBtn) {
      await act(async () => {
        expandBtn.click()
      })
    }

    // Find "Ubicación" button inside expanded detail
    const allButtons = Array.from(container?.querySelectorAll("button") || [])
    const ubicacionBtn = allButtons.find((btn) => btn.textContent?.includes("Ubicación"))

    if (ubicacionBtn) {
      await act(async () => {
        ubicacionBtn.click()
      })
    }

    // Modal should be open with title, lat/lng fields, map section
    expect(document.body.textContent).toContain("Cambiar Ubicación del Suministro 100001")
    expect(document.body.textContent).toContain("Latitud (WGS84)")
    expect(document.body.textContent).toContain("Longitud (WGS84)")
    expect(document.body.textContent).toContain("Ubicación en el Mapa")
    expect(document.body.textContent).toContain("pinchito")
  })

  it("switches to Medidores tab", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SuppliesWorkspace />
        </MemoryRouter>,
      )
    })

    const tabs = container?.querySelectorAll('[role="tab"]')
    const medidoresTab = Array.from(tabs || []).find((t) => t.textContent?.includes("Medidores"))

    if (medidoresTab) {
      await act(async () => {
        (medidoresTab as HTMLElement).click()
      })
    }

    expect(container?.textContent).toContain("Serie / Código Medidor")
    expect(container?.textContent).toContain("MED-98231")
  })

  it("filters client master table when searching", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SuppliesWorkspace />
        </MemoryRouter>,
      )
    })

    const searchInput = container?.querySelector('input[placeholder*="Buscar"]') as HTMLInputElement
    if (searchInput) {
      await act(async () => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set
        nativeInputValueSetter?.call(searchInput, "REBAGLIATI")
        searchInput.dispatchEvent(new Event("input", { bubbles: true }))
      })
    }

    expect(container?.textContent).toContain("HOSPITAL NACIONAL EDGARDO REBAGLIATI MARTINS")
    expect(container?.textContent).not.toContain("UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS")
  })
})

