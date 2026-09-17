import { AlertTriangle, CheckCircle2, Loader2, PenLine, Trash2, Upload, UserCircle2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button, Panel } from "@/components/ui"
import { useSession } from "@/app/session/sessionContext"
import { deleteMySignature, getMySignature, pickAndUploadMySignature } from "@/features/profile/api"
import type { SignatureStatus } from "@/features/profile/api"
import { ipcErrorMessage } from "@/lib/ipc"

function errorText(error: unknown, fallback: string): string {
  const message = ipcErrorMessage(error)
  return message && message !== "[object object]" ? message : fallback
}

export function ProfileRoute(): React.JSX.Element {
  const { session } = useSession()
  const [signature, setSignature] = useState<SignatureStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getMySignature(true)
      setSignature(result)
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error, "No se pudo cargar la firma guardada.") })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load() })
    return () => window.cancelAnimationFrame(frame)
  }, [load])

  async function uploadSignature() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const picked = await pickAndUploadMySignature()
      if (picked) {
        setNotice({ kind: "success", text: "Firma digital guardada." })
        await load()
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error, "No se pudo guardar la firma.") })
    } finally {
      setBusy(false)
    }
  }

  async function removeSignature() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await deleteMySignature()
      setNotice({ kind: "success", text: "Firma digital eliminada." })
      await load()
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error, "No se pudo eliminar la firma.") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="h-full min-w-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary uppercase"><UserCircle2 aria-hidden="true" size={15} /> Mi perfil</p>
          <h1 className="mt-1 text-lg font-semibold">{session?.user?.email ?? "Sesión activa"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Usuario: {session?.user?.username ?? "—"} · Rol: {session?.user?.role ?? "—"}</p>
        </header>

        {notice ? (
          <div className={`rounded-md border px-3 py-2 text-sm ${notice.kind === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-emerald-600/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"}`} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.kind === "error" ? <AlertTriangle aria-hidden="true" className="mr-1.5 inline size-3.5" /> : <CheckCircle2 aria-hidden="true" className="mr-1.5 inline size-3.5" />}
            {notice.text}
          </div>
        ) : null}

        <Panel className="p-4">
          <div className="flex items-center gap-2">
            <PenLine aria-hidden="true" className="text-primary" size={16} />
            <h2 className="font-semibold">Firma digital</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Se inserta automáticamente en la casilla "Responsable de Elaboración" al generar el Word de un informe ITC que tengas asignado.
          </p>

          <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-48 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/20">
              {loading ? <Loader2 aria-hidden="true" className="animate-spin text-muted-foreground" size={20} /> : null}
              {!loading && signature?.dataUrl ? <img alt="Firma digital" className="max-h-full max-w-full object-contain" src={signature.dataUrl} /> : null}
              {!loading && !signature?.dataUrl ? <p className="px-3 text-center text-xs text-muted-foreground">Sin firma guardada</p> : null}
            </div>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => { void uploadSignature() }} size="sm">
                {busy ? <Loader2 aria-hidden="true" className="animate-spin" size={14} /> : <Upload aria-hidden="true" size={14} />}
                {signature?.hasSignature ? "Reemplazar" : "Subir firma"}
              </Button>
              {signature?.hasSignature ? (
                <Button disabled={busy} onClick={() => { void removeSignature() }} size="sm" variant="outline">
                  <Trash2 aria-hidden="true" size={14} /> Quitar
                </Button>
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Formatos admitidos: PNG o JPG, hasta 4 MB.</p>
        </Panel>
      </div>
    </main>
  )
}
