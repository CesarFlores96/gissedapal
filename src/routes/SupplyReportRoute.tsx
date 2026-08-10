import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { useSession } from "../app/session/sessionContext"
import { ReportPanel } from "../components/ReportPanel"
import { friendlyError } from "../lib/errors"
import { getSupplyReport } from "../lib/ipc"
import type { SupplyReport } from "../types"

/**
 * El reporte solo depende del código de suministro, así que la ruta lo lleva
 * entero: recargar la ventana sobre `#/suministro/100001` reconstruye la vista
 * sin depender de ningún estado previo.
 */
export function SupplyReportRoute(): React.JSX.Element {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { reportError } = useSession()
  const [data, setData] = useState<SupplyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let active = true
    // Diferido un microtask: el linter de efectos prohíbe llamar a setState de
    // forma síncrona en el cuerpo del efecto.
    void Promise.resolve()
      .then(() => {
        if (active) { setData(null); setError(null); setLoading(true) }
        return getSupplyReport(code)
      })
      .then((report) => { if (active) setData(report) })
      .catch((reason: unknown) => {
        if (!active) return
        if (!reportError(reason)) setError(friendlyError(reason))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [code, reportError])

  return (
    <ReportPanel
      data={data}
      error={error}
      loading={loading}
      onClose={() => { void navigate("/mapa") }}
      supplyCode={code ?? null}
    />
  )
}
