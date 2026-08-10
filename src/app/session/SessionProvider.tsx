import { useCallback, useEffect, useMemo, useState } from "react"
import { Outlet } from "react-router"
import type { Update } from "@tauri-apps/plugin-updater"

import { clearAlertsCache } from "../../features/alerts/dropsCache"
import { clearCoverageCache } from "../../features/map/coverageCache"
import { INITIAL_BBOX, INITIAL_LAYERS, INITIAL_ZOOM, setInitialLayersPreload } from "../../features/map/initialPreload"
import { getTileServerUrl } from "../../features/map/lotContext"
import { defaultConsumptionFilter } from "../../features/reports/defaultFilter"
import { clearSupplyCaches } from "../../features/selection/supplyCaches"
import { friendlyError, isExpiredSession } from "../../lib/errors"
import * as ipc from "../../lib/ipc"
import type { SessionSnapshot } from "../../types"
import { SessionContext } from "./sessionContext"
import { UpdateDialog } from "./UpdateDialog"

// Sin esto, cuando el chequeo de actualización y la sesión resuelven rápido
// (todo cacheado, red local) el splash parpadea menos de un segundo. En tests
// se salta: ahí no hay nada que mostrar y sólo alargaría cada corrida.
const MIN_SPLASH_MS = import.meta.env.MODE === "test" ? 0 : 1500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function SessionProvider(): React.JSX.Element {
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [bootStatus, setBootStatus] = useState("Buscando actualizaciones…")
  const [authError, setAuthError] = useState<string | null>(null)
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null)

  useEffect(() => {
    let active = true
    const startedAt = Date.now()

    async function boot(): Promise<void> {
      try {
        const update = await withTimeout(ipc.checkForUpdate(), 8000)
        if (update && active) {
          setAvailableUpdate(update)
        }
      } catch {
        // Sin conexión o falló el chequeo: seguimos con la versión actual.
      }
      if (!active) return

      setBootStatus("Iniciando sesión…")
      const value = await ipc.getSession().catch(
        () => ({ authenticated: false, user: null }) as SessionSnapshot,
      )
      if (!active) return

      if (value.authenticated) {
        setBootStatus("Cargando datos iniciales…")
        const filter = defaultConsumptionFilter()
        const [layers] = await Promise.allSettled([
          ipc.fetchGisLayers({ bbox: INITIAL_BBOX, layers: INITIAL_LAYERS, page: 1, pageSize: 2000, zoom: INITIAL_ZOOM }),
          ipc.fetchDistricts(),
          getTileServerUrl(),
          // Sólo entibia la caché de 60s de Rust: ReportsWorkspace pide esto mismo
          // recién si el usuario abre Análisis → Reportes.
          ipc.getReportsMaster({
            page: 1, pageSize: 25, search: "", filterActive: false, sortOrder: "desc",
            trendDirection: filter.direction, minTrendPercent: filter.percentage,
            baselineStartPeriod: filter.baselineStartPeriod, baselineEndPeriod: filter.baselineEndPeriod,
            targetStartPeriod: filter.targetStartPeriod, targetEndPeriod: filter.targetEndPeriod,
          }),
        ])
        // MapDataProvider todavía no está montado: no hay a quién entregarle esto
        // más que dejarlo en el módulo de preload para que lo consuma al montar.
        if (layers.status === "fulfilled") setInitialLayersPreload(layers.value)
        if (!active) return
      }

      const remaining = MIN_SPLASH_MS - (Date.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      if (!active) return

      setSession(value)
    }

    void boot()
    return () => { active = false }
  }, [])

  const login = useCallback(async (identifier: string, password: string): Promise<void> => {
    setAuthError(null)
    try {
      setSession(await ipc.login(identifier, password))
    } catch (error) {
      setAuthError(friendlyError(error))
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    await ipc.logout()
    // Las cachés son de ámbito de módulo, así que se vacían con llamadas
    // directas en vez de acoplar este provider con los demás.
    clearSupplyCaches()
    clearCoverageCache()
    clearAlertsCache()
    setSession({ authenticated: false, user: null })
  }, [])

  const reportError = useCallback((reason: unknown): boolean => {
    if (!isExpiredSession(reason)) return false
    setAuthError(friendlyError(reason))
    setSession({ authenticated: false, user: null })
    return true
  }, [])

  const dismissUpdate = useCallback(() => {
    const update = availableUpdate
    setAvailableUpdate(null)
    void update?.close()
  }, [availableUpdate])

  const value = useMemo(
    () => ({ session, bootStatus, authError, login, logout, reportError }),
    [session, bootStatus, authError, login, logout, reportError],
  )

  return (
    <SessionContext value={value}>
      <Outlet />
      <UpdateDialog update={availableUpdate} onDismiss={dismissUpdate} />
    </SessionContext>
  )
}
