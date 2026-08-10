import { useCallback, useEffect, useMemo, useReducer } from "react"
import type { ReactNode } from "react"

import { MdiContext } from "./mdiContext"
import type { OpenWindowInput } from "./mdiContext"
import { EMPTY_MDI_STATE, fitRect, mdiReducer } from "./mdiState"
import type { MdiState } from "./mdiState"

const STORAGE_KEY = "sedapalgis.indicators.mdi.v2"

function loadState(): MdiState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as MdiState | null
    if (parsed && Array.isArray(parsed.windows)) return { ...parsed, selectedView: parsed.selectedView ?? "consumption" }
  } catch { /* Un layout incompatible no debe impedir abrir Reportes. */ }
  return EMPTY_MDI_STATE
}

export function MdiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(mdiReducer, EMPTY_MDI_STATE, loadState)
  useEffect(() => { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }, [state])

  const openWindow = useCallback((input: OpenWindowInput) => {
    const offset = state.windows.length % 7
    const rect = fitRect({ x: 22 + offset * 28, y: 20 + offset * 28, width: 720, height: 520 }, input.workspace)
    const zIndex = state.zCounter + 1
    dispatch({ type: "OPEN", window: {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      view: input.view, title: input.title, context: input.context,
      mode: "normal", rect, restoreRect: null, zIndex,
    } })
  }, [state.windows.length, state.zCounter])

  const value = useMemo(() => ({ state, dispatch, openWindow }), [openWindow, state])
  return <MdiContext.Provider value={value}>{children}</MdiContext.Provider>
}
