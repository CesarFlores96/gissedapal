import { createContext, useContext } from "react"

import type { IndicatorContext, IndicatorViewKey, MdiAction, MdiState, WorkspaceSize } from "./mdiState"

export type OpenWindowInput = { view: IndicatorViewKey; title: string; context: IndicatorContext; workspace: WorkspaceSize }
export type MdiContextValue = { state: MdiState; dispatch: React.Dispatch<MdiAction>; openWindow: (input: OpenWindowInput) => void }
export const MdiContext = createContext<MdiContextValue | null>(null)

export function useMdi(): MdiContextValue {
  const value = useContext(MdiContext)
  if (!value) throw new Error("useMdi debe usarse dentro de MdiProvider")
  return value
}
