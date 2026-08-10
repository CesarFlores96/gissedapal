import { Download, RefreshCw, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { Update } from "@tauri-apps/plugin-updater"

import { Button } from "../../components/ui"
import { relaunchApp } from "../../lib/ipc"

type UpdatePhase = "available" | "downloading" | "installing" | "restarting" | "error"

type UpdateDialogProps = {
  update: Update | null
  onDismiss: () => void
}

export function UpdateDialog({ update, onDismiss }: UpdateDialogProps): React.JSX.Element | null {
  const [phase, setPhase] = useState<UpdatePhase>("available")
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)

  useEffect(() => {
    setPhase("available")
    setDownloadedBytes(0)
    setTotalBytes(null)
  }, [update])

  if (!update) return null

  const busy = phase === "downloading" || phase === "installing" || phase === "restarting"
  const percent = totalBytes && totalBytes > 0
    ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
    : null

  async function install(): Promise<void> {
    const selectedUpdate = update
    if (!selectedUpdate) return
    setPhase("downloading")
    try {
      await selectedUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") setTotalBytes(event.data.contentLength ?? null)
        else if (event.event === "Progress") setDownloadedBytes((current) => current + event.data.chunkLength)
        else setPhase("installing")
      })
      setPhase("restarting")
      await relaunchApp()
    } catch {
      setPhase("error")
    }
  }

  const description = phase === "available"
    ? `Hay una nueva versión ${update.version} lista para descargar.`
    : phase === "downloading"
      ? percent === null ? "Descargando actualización…" : `Descargando actualización… ${percent}%`
      : phase === "installing"
        ? "Instalando actualización…"
        : phase === "restarting"
          ? "Reiniciando SEDAPAL GIS…"
          : "No se pudo instalar la actualización. Puedes intentarlo nuevamente."

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" role="presentation">
      <section aria-describedby="update-description" aria-labelledby="update-title" aria-modal="true" className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl" role="dialog">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Download aria-hidden="true" size={20} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold" id="update-title">Nueva versión {update.version} disponible</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground" id="update-description">{description}</p>
          </div>
          {!busy && <Button aria-label="Cerrar aviso de actualización" className="-mr-2 -mt-2" onClick={onDismiss} size="icon" variant="ghost"><X aria-hidden="true" size={18} /></Button>}
        </div>

        {busy && <div aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent ?? undefined} className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar"><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: percent === null ? "35%" : `${percent}%` }} /></div>}

        <div className="mt-5 flex justify-end gap-2">
          {!busy && <Button onClick={onDismiss} variant="ghost">Más tarde</Button>}
          <Button disabled={busy} onClick={() => void install()}>
            {phase === "error" ? <RefreshCw aria-hidden="true" size={16} /> : <Download aria-hidden="true" size={16} />}
            {phase === "error" ? "Reintentar" : "Descargar e instalar"}
          </Button>
        </div>
      </section>
    </div>
  )
}
