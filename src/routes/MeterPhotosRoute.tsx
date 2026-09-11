import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { meterApi, meterError } from "@/features/meter-photos/api"
import { useMeterQueue } from "@/features/meter-photos/queueContext"
import { QueuePanel } from "@/features/meter-photos/QueuePanel"
import { ResultsPanel } from "@/features/meter-photos/ResultsPanel"
import { GraphPanel } from "@/features/meter-photos/GraphPanel"
import { ConfigPanel } from "@/features/meter-photos/ConfigPanel"
import { Notice } from "@/features/meter-photos/shared"
import type { MeterConfigBundle, MeterRun } from "@/features/meter-photos/types"

export function MeterPhotosRoute() {
  const { state } = useMeterQueue()
  const [tab, setTab] = useState("queue")
  const [config, setConfig] = useState<MeterConfigBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const reload = useCallback(async () => {
    try { setConfig(await meterApi.config()); setError(null) }
    catch (err) { setError(meterError(err)) }
  }, [])
  useEffect(() => {
    let current = true
    void meterApi.config().then((value) => { if (current) setConfig(value) }).catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [])
  async function exportRun(run: MeterRun) {
    if (exporting) return
    setExporting(true); setStatus(null)
    try {
      if (run.status === "running") throw new Error("Espera a que finalice esta ejecución para exportar.")
      const result = await meterApi.export(run.id)
      if (result) setStatus(`Excel guardado: ${result.rowCount} fotografías. ${result.path}`)
    } catch (err) { setError(meterError(err)) }
    finally { setExporting(false) }
  }
  return <main className="h-full min-w-0 overflow-y-auto bg-background p-4 sm:p-6">
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold">Fotografías de medidores</h1><p className="mt-1 text-sm text-muted-foreground">Selecciona una carpeta, revisa los informes y exporta los resultados.</p></div><Button variant="outline" onClick={() => { void reload() }}>Actualizar configuración</Button></header>
      {error && <Notice error>{error}</Notice>}{status && <Notice>{status}</Notice>}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <div className="overflow-x-auto border-b pb-2"><TabsList variant="line"><TabsTrigger value="queue">Cola de análisis</TabsTrigger><TabsTrigger value="results">Resultados y Excel</TabsTrigger><TabsTrigger value="graph">Grafo de incidencias</TabsTrigger><TabsTrigger value="config">Configuración</TabsTrigger></TabsList></div>
        <TabsContent value="queue"><QueuePanel config={config} /></TabsContent>
        <TabsContent value="results"><ResultsPanel runId={state.runId ?? undefined} onRun={(run) => { void exportRun(run) }} /></TabsContent>
        <TabsContent value="graph"><GraphPanel key={state.runId ?? "all"} runId={state.runId ?? undefined} /></TabsContent>
        <TabsContent value="config">{config ? <ConfigPanel config={config} onSaved={reload} /> : <Notice>No se pudo cargar la configuración. Comprueba la conexión y que el módulo esté habilitado en el servidor.</Notice>}</TabsContent>
      </Tabs>
    </div>
  </main>
}
