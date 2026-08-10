export type IndicatorViewKey =
  | "consumption"
  | "spatial"
  | "comparative"
  | "efficiency"
  | "risk"
  | "economic"
  | "predictive"
  | "esce"

export type MdiRect = { x: number; y: number; width: number; height: number }
export type WorkspaceSize = { width: number; height: number }

export type IndicatorContext = {
  supplyCode?: string
  lotId?: string
  districtCode?: string
  startPeriod?: string
  endPeriod?: string
}

export type MdiWindowState = {
  id: string
  view: IndicatorViewKey
  title: string
  mode: "normal" | "minimized" | "maximized"
  rect: MdiRect
  restoreRect: MdiRect | null
  zIndex: number
  context: IndicatorContext
}

export type MdiState = {
  windows: MdiWindowState[]
  activeWindowId: string | null
  selectedView: IndicatorViewKey
  zCounter: number
}

export type MdiAction =
  | { type: "OPEN"; window: MdiWindowState }
  | { type: "FOCUS"; id: string }
  | { type: "SET_CONTEXT"; id: string; context: Partial<IndicatorContext> }
  | { type: "SET_ACTIVE_VIEW"; view: IndicatorViewKey; title: string }
  | { type: "SET_RECT"; id: string; rect: MdiRect }
  | { type: "MINIMIZE"; id: string }
  | { type: "MAXIMIZE"; id: string }
  | { type: "RESTORE"; id: string }
  | { type: "CLOSE"; id: string }
  | { type: "CASCADE"; workspace: WorkspaceSize }
  | { type: "TILE"; direction: "horizontal" | "vertical"; workspace: WorkspaceSize }
  | { type: "CLAMP"; workspace: WorkspaceSize }

export const EMPTY_MDI_STATE: MdiState = { windows: [], activeWindowId: null, selectedView: "consumption", zCounter: 0 }
const MIN_WIDTH = 360
const MIN_HEIGHT = 260

export function fitRect(rect: MdiRect, workspace: WorkspaceSize): MdiRect {
  const width = Math.max(Math.min(rect.width, workspace.width), Math.min(MIN_WIDTH, workspace.width))
  const height = Math.max(Math.min(rect.height, workspace.height), Math.min(MIN_HEIGHT, workspace.height))
  return {
    width,
    height,
    x: Math.max(0, Math.min(rect.x, workspace.width - width)),
    y: Math.max(0, Math.min(rect.y, workspace.height - height)),
  }
}

function focusWindow(state: MdiState, id: string): MdiState {
  const nextZ = state.zCounter + 1
  return {
    ...state,
    windows: state.windows.map((window) => window.id === id ? { ...window, zIndex: nextZ } : window),
    activeWindowId: id,
    zCounter: nextZ,
  }
}

export function mdiReducer(state: MdiState, action: MdiAction): MdiState {
  switch (action.type) {
    case "OPEN":
      return { ...state, windows: [...state.windows, action.window], activeWindowId: action.window.id, zCounter: Math.max(state.zCounter, action.window.zIndex) }
    case "FOCUS":
      return focusWindow(state, action.id)
    case "SET_CONTEXT":
      return { ...state, windows: state.windows.map((window) => window.id === action.id ? { ...window, context: { ...window.context, ...action.context } } : window) }
    case "SET_ACTIVE_VIEW":
      return { ...state, selectedView: action.view }
    case "SET_RECT":
      return { ...state, windows: state.windows.map((window) => window.id === action.id ? { ...window, rect: action.rect } : window) }
    case "MINIMIZE": {
      const windows = state.windows.map((window) => window.id === action.id ? { ...window, mode: "minimized" as const } : window)
      const fallback = [...windows].filter((window) => window.mode !== "minimized" && window.id !== action.id).sort((a, b) => b.zIndex - a.zIndex)[0]
      return { ...state, windows, activeWindowId: fallback?.id ?? null }
    }
    case "MAXIMIZE":
      return focusWindow({ ...state, windows: state.windows.map((window) => window.id === action.id ? { ...window, mode: "maximized", restoreRect: window.mode === "normal" ? window.rect : window.restoreRect } : window) }, action.id)
    case "RESTORE":
      return focusWindow({ ...state, windows: state.windows.map((window) => window.id === action.id ? { ...window, mode: "normal", rect: window.restoreRect ?? window.rect, restoreRect: null } : window) }, action.id)
    case "CLOSE": {
      const windows = state.windows.filter((window) => window.id !== action.id)
      const fallback = [...windows].filter((window) => window.mode !== "minimized").sort((a, b) => b.zIndex - a.zIndex)[0]
      return { ...state, windows, activeWindowId: state.activeWindowId === action.id ? fallback?.id ?? null : state.activeWindowId }
    }
    case "CASCADE": {
      const visible = state.windows.filter((window) => window.mode !== "minimized")
      const width = Math.max(Math.min(action.workspace.width - Math.max(visible.length - 1, 0) * 28, 760), Math.min(MIN_WIDTH, action.workspace.width))
      const height = Math.max(Math.min(action.workspace.height - Math.max(visible.length - 1, 0) * 28, 560), Math.min(MIN_HEIGHT, action.workspace.height))
      let index = 0
      return { ...state, windows: state.windows.map((window) => window.mode === "minimized" ? window : { ...window, mode: "normal", restoreRect: null, rect: { x: index * 28, y: index++ * 28, width, height } }) }
    }
    case "TILE": {
      const visible = state.windows.filter((window) => window.mode !== "minimized")
      if (visible.length === 0) return state
      const horizontal = action.direction === "horizontal"
      const cellWidth = horizontal ? action.workspace.width : action.workspace.width / visible.length
      const cellHeight = horizontal ? action.workspace.height / visible.length : action.workspace.height
      let index = 0
      return { ...state, windows: state.windows.map((window) => {
        if (window.mode === "minimized") return window
        const currentIndex = index++
        return { ...window, mode: "normal", restoreRect: null, rect: { x: horizontal ? 0 : currentIndex * cellWidth, y: horizontal ? currentIndex * cellHeight : 0, width: cellWidth, height: cellHeight } }
      }) }
    }
    case "CLAMP":
      return { ...state, windows: state.windows.map((window) => ({ ...window, rect: fitRect(window.rect, action.workspace), restoreRect: window.restoreRect ? fitRect(window.restoreRect, action.workspace) : null })) }
  }
}
