import { ArrowDown, Droplets } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"

import { useSession } from "../app/session/sessionContext"
import { Button } from "../components/ui"
import { getCachedScan, loadScan } from "../features/alerts/dropsCache"
import { useSelection } from "../features/selection/selectionContext"
import { friendlyError } from "../lib/errors"
import { getAbruptConsumptionDrops } from "../lib/ipc"
import type { ConsumptionDropScan } from "../types"

function volume(value: number): string {
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: 1 })} m³`
}

function period(value: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00`)
  return new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(date)
}

/**
 * Antes era un modal a pantalla completa sobre el mapa. Es una lista que se
 * revisa y sobre la que se actúa, no una confirmación: como página propia deja
 * de tapar el mapa sin motivo y gana espacio de lectura.
 */
export function AlertsRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const { reportError } = useSession()
  const { selectSupply } = useSelection()
  const [data, setData] = useState<ConsumptionDropScan | null>(() => getCachedScan())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (getCachedScan()) return
    let active = true
    // El estado de carga se difiere un microtask: el linter de efectos prohíbe
    // llamar a setState de forma síncrona en el cuerpo del efecto.
    void Promise.resolve()
      .then(() => {
        if (active) { setLoading(true); setError(null) }
        return loadScan(getAbruptConsumptionDrops)
      })
      .then((scan) => { if (active) setData(scan) })
      .catch((reason: unknown) => {
        if (!active) return
        if (!reportError(reason)) setError(friendlyError(reason))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reportError])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <p className="mb-5 max-w-prose text-xs leading-5 text-muted-foreground">
          Detecta meses consecutivos con consumo facturado igual a cero o menor al 15% del promedio de los tres meses previos.
        </p>

        {loading ? (
          <div aria-busy="true" className="space-y-2">
            {[1, 2, 3, 4, 5].map((item) => <div className="h-20 animate-pulse rounded-md bg-muted" key={item} />)}
          </div>
        ) : error ? (
          <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : data?.items.length ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {data.total.toLocaleString("es-PE")} coincidencias{data.total > data.items.length ? ` · mostrando las ${data.items.length} más recientes` : ""}
            </p>
            <ul className="space-y-2">
              {data.items.map((item) => (
                <li className="rounded-md border bg-card p-3" key={`${item.supplyCode}-${item.period}`}>
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${item.kind === "zero" ? "bg-destructive/10 text-destructive" : "bg-chart-5/10 text-chart-5"}`}>
                      <ArrowDown aria-hidden="true" size={15} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.supplyCode}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.customerName ?? "Cliente no registrado"} · {item.district ?? "Sin distrito"}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${item.kind === "zero" ? "text-destructive" : "text-chart-5"}`}>-{item.dropPercent}%</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Droplets aria-hidden="true" className="text-primary" size={13} />
                    <span className="capitalize">{period(item.period)}:</span>
                    <strong className="text-foreground">{volume(item.currentVolume)}</strong>
                    <span>vs. {volume(item.referenceVolume)}</span>
                  </div>
                  <Button
                    className="mt-3 w-full"
                    onClick={() => {
                      void selectSupply(item.supplyCode)
                      void navigate("/mapa")
                    }}
                    size="lg"
                    variant="outline"
                  >
                    Ver en el mapa
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="rounded-md border bg-card px-3 py-10 text-center">
            <Droplets aria-hidden="true" className="mx-auto mb-2 text-primary" size={20} />
            <p className="text-sm font-medium">No hay caídas abruptas detectadas</p>
            <p className="mt-1 text-xs text-muted-foreground">No se encontraron cambios que cumplan el criterio en la facturación disponible.</p>
          </div>
        )}
      </div>
    </div>
  )
}
