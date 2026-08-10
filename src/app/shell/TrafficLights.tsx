import { useCallback, useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"

/**
 * Botones de control de ventana estilo macOS (traffic lights).
 *
 * Los tres círculos (cerrar, minimizar, maximizar) aparecen siempre. Los iconos
 * internos (×, −, ⛶) solo se muestran al hacer hover sobre el grupo completo,
 * imitando el comportamiento real de macOS.
 *
 * Las acciones usan la API de ventana de Tauri v2. Fuera de un contexto Tauri
 * real (p. ej. en tests con jsdom) `getCurrentWindow()` explota porque
 * `window.__TAURI_INTERNALS__` no existe, así que se evita invocarla.
 */
function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window
}

export function TrafficLights(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauriRuntime()) return

    let cancelled = false
    const win = getCurrentWindow()
    void win.isMaximized().then((v) => { if (!cancelled) setMaximized(v) })

    const unlisten = win.onResized(() => {
      void win.isMaximized().then((v) => { if (!cancelled) setMaximized(v) })
    })

    return () => {
      cancelled = true
      void unlisten.then((fn) => fn())
    }
  }, [])

  const handleClose = useCallback(() => { if (isTauriRuntime()) void getCurrentWindow().close() }, [])
  const handleMinimize = useCallback(() => { if (isTauriRuntime()) void getCurrentWindow().minimize() }, [])
  const handleToggleMaximize = useCallback(() => { if (isTauriRuntime()) void getCurrentWindow().toggleMaximize() }, [])

  return (
    <div className="traffic-lights" role="group" aria-label="Controles de ventana" data-tauri-drag-region>
      {/* Cerrar */}
      <button
        aria-label="Cerrar"
        className="tl-btn tl-close"
        onClick={handleClose}
        type="button"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>

      {/* Minimizar */}
      <button
        aria-label="Minimizar"
        className="tl-btn tl-minimize"
        onClick={handleMinimize}
        type="button"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <line x1="2.5" y1="6" x2="9.5" y2="6" />
        </svg>
      </button>

      {/* Maximizar / Restaurar */}
      <button
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        className="tl-btn tl-maximize"
        onClick={handleToggleMaximize}
        type="button"
      >
        {maximized ? (
          /* Icono de restaurar: dos rectángulos superpuestos */
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1.5" y="3.5" width="7" height="7" rx="0.5" fill="none" />
            <path d="M3.5 3.5V1.75a.5.5 0 0 1 .5-.5h6.25a.5.5 0 0 1 .5.5V8a.5.5 0 0 1-.5.5H8.5" fill="none" />
          </svg>
        ) : (
          /* Icono de maximizar: triángulo expandir */
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5V4a2 2 0 0 1 2-2h4.5" fill="none" />
            <path d="M6 2l4 0l0 4" fill="none" />
          </svg>
        )}
      </button>
    </div>
  )
}
