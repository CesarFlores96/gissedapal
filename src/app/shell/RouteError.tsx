import { TriangleAlert } from "lucide-react"
import { useRouteError } from "react-router"

import { Button } from "../../components/ui"
import { friendlyError } from "../../lib/errors"

/**
 * Frontera de error por ruta. El caso frecuente en escritorio es un chunk
 * perezoso cuyo nombre quedó obsoleto tras reconstruir con la app abierta: sin
 * esto la ventana se queda en blanco sin explicación.
 */
export function RouteError(): React.JSX.Element {
  const error = useRouteError()

  return (
    <main className="grid h-full place-items-center bg-background p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert aria-hidden="true" size={20} strokeWidth={1.75} />
        </div>
        <h1 className="font-heading text-base font-semibold">No se pudo abrir esta vista</h1>
        <p className="text-sm text-muted-foreground">{friendlyError(error)}</p>
        <Button className="mt-1" onClick={() => window.location.reload()} variant="primary">
          Recargar
        </Button>
      </div>
    </main>
  )
}
