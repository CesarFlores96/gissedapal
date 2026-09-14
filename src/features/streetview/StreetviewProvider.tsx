import { type ReactNode, useEffect, useMemo, useState } from "react"

import { StreetviewContext, type FacadeReadySignal, type FloorAnalysis, type StreetviewPosition } from "./streetviewContext"

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window
}

/**
 * Escucha los eventos que empuja Rust mientras la ventana de Google Street
 * View (`open_maps_window`) está abierta en modo "streetview": posición/heading
 * en vivo (parseados de la URL de esa ventana) y el resultado del análisis de
 * pisos con Ollama. No hay `invoke()` de por medio -- es la primera vez en el
 * proyecto que el backend empuja eventos en vez de responder a un pedido.
 */
export function StreetviewProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [position, setPosition] = useState<StreetviewPosition | null>(null)
  const [floorAnalysis, setFloorAnalysis] = useState<FloorAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [facadeReady, setFacadeReady] = useState<FacadeReadySignal | null>(null)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    const unlisten: Array<() => void> = []

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event")
      if (cancelled) return

      unlisten.push(await listen<StreetviewPosition>("streetview:position", (event) => {
        setPosition(event.payload)
      }))
      // Se dispara justo antes de capturar/mandar a Ollama, para que la UI
      // muestre de inmediato que hay un análisis en curso (puede tardar hasta
      // el timeout de 60s) en vez de quedarse sin feedback hasta el resultado.
      unlisten.push(await listen<StreetviewPosition>("streetview:analyzing", () => {
        setAnalyzing(true)
        setFloorAnalysis(null)
      }))
      unlisten.push(await listen<FloorAnalysis>("streetview:floor-analysis", (event) => {
        setAnalyzing(false)
        setFloorAnalysis(event.payload)
      }))
      // Mejor esfuerzo, no bloquea el flujo de pisos/color de arriba (ver
      // `analyze_facade` en streetview.rs): puede no llegar nunca si el lote
      // no tenía frente confiable, y eso es normal.
      unlisten.push(await listen<FacadeReadySignal>("streetview:facade-ready", (event) => {
        setFacadeReady(event.payload)
      }))
      unlisten.push(await listen("streetview:closed", () => {
        setPosition(null)
        setFloorAnalysis(null)
        setAnalyzing(false)
      }))
    })()

    return () => {
      cancelled = true
      for (const fn of unlisten) fn()
    }
  }, [])

  const mapViewProps = useMemo(() => ({
    streetviewPosition: position,
    streetviewFloorAnalysis: floorAnalysis,
    streetviewAnalyzing: analyzing,
    streetviewFacadeReady: facadeReady,
  }), [position, floorAnalysis, analyzing, facadeReady])

  const value = useMemo(() => ({
    position,
    floorAnalysis,
    analyzing,
    facadeReady,
    mapViewProps,
  }), [position, floorAnalysis, analyzing, facadeReady, mapViewProps])

  return <StreetviewContext value={value}>{children}</StreetviewContext>
}
