import { useEffect, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"

import { useSession } from "../app/session/sessionContext"
import { ReportPanel } from "../components/ReportPanel"
import { friendlyError } from "../lib/errors"
import { getClientLotReport } from "../lib/ipc"
import type { ClientLotReport } from "../types"

export function ClientLotReportRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { reportError } = useSession()
  const supplyCodes = Array.from(new Set(searchParams.getAll("nis").map((code) => code.trim()).filter(Boolean)))
  const requestKey = supplyCodes.join(",")
  const [data, setData] = useState<ClientLotReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const requestedCodes = requestKey ? requestKey.split(",") : []
    if (requestedCodes.length < 2) return
    let active = true
    void Promise.resolve()
      .then(() => {
        if (active) { setData(null); setError(null); setLoading(true) }
        return getClientLotReport(requestedCodes)
      })
      .then((report) => { if (active) setData(report) })
      .catch((reason: unknown) => {
        if (!active) return
        if (!reportError(reason)) setError(friendlyError(reason))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // requestKey representa la lista estable; searchParams cambia de identidad
    // aunque la URL conserve exactamente los mismos valores.
  }, [reportError, requestKey])

  const handleClose = () => {
    const state = location.state as { from?: string } | null
    if (state?.from) void navigate(state.from)
    else if (window.history.length > 2) void navigate(-1)
    else void navigate("/analisis/alertas")
  }

  const validationError = supplyCodes.length < 2
    ? "El reporte por cliente y lote requiere al menos dos NIS."
    : null

  return (
    <ReportPanel
      data={data}
      error={validationError ?? error}
      loading={loading}
      onClose={handleClose}
      supplyCode={null}
    />
  )
}
