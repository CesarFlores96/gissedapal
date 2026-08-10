import { describe, expect, it } from "vitest"

import { EMPTY_MDI_STATE, mdiReducer } from "./mdiState"
import type { MdiWindowState } from "./mdiState"

function child(id: string, zIndex = 1): MdiWindowState {
  return {
    id,
    view: "consumption",
    title: `Ventana ${id}`,
    mode: "normal",
    rect: { x: 20, y: 30, width: 500, height: 400 },
    restoreRect: null,
    zIndex,
    context: { supplyCode: "100001" },
  }
}

describe("mdiReducer", () => {
  it("abre, enfoca, minimiza, restaura y cierra ventanas", () => {
    let state = mdiReducer(EMPTY_MDI_STATE, { type: "OPEN", window: child("one") })
    state = mdiReducer(state, { type: "OPEN", window: child("two", 2) })
    expect(state.activeWindowId).toBe("two")

    state = mdiReducer(state, { type: "FOCUS", id: "one" })
    expect(state.activeWindowId).toBe("one")
    expect(state.windows[0]?.zIndex).toBe(3)

    state = mdiReducer(state, { type: "MINIMIZE", id: "one" })
    expect(state.windows[0]?.mode).toBe("minimized")
    expect(state.activeWindowId).toBe("two")

    state = mdiReducer(state, { type: "RESTORE", id: "one" })
    expect(state.windows[0]?.mode).toBe("normal")
    expect(state.activeWindowId).toBe("one")

    state = mdiReducer(state, { type: "CLOSE", id: "one" })
    expect(state.windows.map((window) => window.id)).toEqual(["two"])
    expect(state.activeWindowId).toBe("two")
  })

  it("conserva el rectangulo al maximizar y restaurar", () => {
    const initial = mdiReducer(EMPTY_MDI_STATE, { type: "OPEN", window: child("one") })
    const maximized = mdiReducer(initial, { type: "MAXIMIZE", id: "one" })
    expect(maximized.windows[0]).toMatchObject({ mode: "maximized", restoreRect: initial.windows[0]?.rect })

    const restored = mdiReducer(maximized, { type: "RESTORE", id: "one" })
    expect(restored.windows[0]).toMatchObject({ mode: "normal", rect: initial.windows[0]?.rect, restoreRect: null })
  })

  it("organiza ventanas visibles en cascada y mosaicos", () => {
    let state = mdiReducer(EMPTY_MDI_STATE, { type: "OPEN", window: child("one") })
    state = mdiReducer(state, { type: "OPEN", window: child("two", 2) })
    const workspace = { width: 1000, height: 600 }

    const cascade = mdiReducer(state, { type: "CASCADE", workspace })
    expect(cascade.windows[0]?.rect).toMatchObject({ x: 0, y: 0 })
    expect(cascade.windows[1]?.rect).toMatchObject({ x: 28, y: 28 })

    const vertical = mdiReducer(cascade, { type: "TILE", direction: "vertical", workspace })
    expect(vertical.windows.map((window) => window.rect)).toEqual([
      { x: 0, y: 0, width: 500, height: 600 },
      { x: 500, y: 0, width: 500, height: 600 },
    ])

    const horizontal = mdiReducer(cascade, { type: "TILE", direction: "horizontal", workspace })
    expect(horizontal.windows.map((window) => window.rect)).toEqual([
      { x: 0, y: 0, width: 1000, height: 300 },
      { x: 0, y: 300, width: 1000, height: 300 },
    ])
  })

  it("mantiene las ventanas dentro del workspace al redimensionar", () => {
    const outside = { ...child("one"), rect: { x: 800, y: 500, width: 700, height: 600 } }
    const state = mdiReducer(mdiReducer(EMPTY_MDI_STATE, { type: "OPEN", window: outside }), { type: "CLAMP", workspace: { width: 640, height: 420 } })
    expect(state.windows[0]?.rect).toEqual({ x: 0, y: 0, width: 640, height: 420 })
  })

  it("cambia de familia sin reemplazar los documentos existentes", () => {
    const initial = mdiReducer(EMPTY_MDI_STATE, { type: "OPEN", window: child("consumption") })
    const spatial = mdiReducer(initial, { type: "SET_ACTIVE_VIEW", view: "spatial", title: "Indicadores espaciales" })

    expect(spatial.selectedView).toBe("spatial")
    expect(spatial.windows).toEqual(initial.windows)
    expect(spatial.windows[0]?.view).toBe("consumption")
  })
})
