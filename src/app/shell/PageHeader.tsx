import type { ReactNode } from "react"

/**
 * Cabecera por defecto de una ruta. El `<h1>` recibe el foco al navegar (lo
 * mueve `AppShell`), así que lleva `tabIndex={-1}` y `id` fijo.
 */
export function PageHeader({ actions, title }: { actions?: ReactNode; title?: string }): React.JSX.Element {
  return (
    <>
      <h1
        className="min-w-0 flex-1 truncate font-heading text-sm font-semibold tracking-tight outline-none"
        id="route-title"
        tabIndex={-1}
        data-tauri-drag-region
      >
        {title ?? ""}
      </h1>
      {actions}
    </>
  )
}
