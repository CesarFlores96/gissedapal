import { Droplets, LoaderCircle, LockKeyhole, UserRound } from "lucide-react"
import { useState, type FormEvent } from "react"

import { TrafficLights } from "../app/shell/TrafficLights"
import { Button, Field, Panel } from "./ui"

type LoginPageProps = {
  error: string | null
  onLogin: (identifier: string, password: string) => Promise<void>
}

export function LoginPage({ error, onLogin }: LoginPageProps): React.JSX.Element {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!identifier.trim() || !password || pending) return
    setPending(true)
    try {
      await onLogin(identifier.trim(), password)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid h-screen grid-rows-[3rem_1fr] overflow-hidden bg-muted/30 text-foreground">
      {/* Title bar personalizada: la ventana no tiene decoraciones nativas
          (`decorations: false`), así que el login también necesita esta franja
          para poder cerrar/minimizar/maximizar. */}
      <header className="flex h-12 min-w-0 shrink-0 items-center justify-end border-b bg-background px-3" data-tauri-drag-region>
        <TrafficLights />
      </header>

      <main className="grid min-h-0 place-items-center overflow-hidden p-5">
        <Panel className="w-full max-w-sm p-6 sm:p-8" elevation="raised">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-md border bg-primary/5 text-primary">
              <Droplets aria-hidden="true" size={24} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">SEDAPAL</p>
              <h1 className="text-xl font-semibold">Visor GIS de Lima</h1>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field
              autoComplete="username"
              icon={<UserRound aria-hidden="true" size={17} strokeWidth={1.75} />}
              controlSize="lg"
              label="Usuario o correo"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Ingresa tu usuario"
              showLabel
              value={identifier}
            />

            <Field
              autoComplete="current-password"
              icon={<LockKeyhole aria-hidden="true" size={17} strokeWidth={1.75} />}
              controlSize="lg"
              label="Contraseña"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Ingresa tu contraseña"
              showLabel
              type="password"
              value={password}
            />

            {error ? (
              <p
                className="rounded-[var(--radius-control)] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <Button
              className="w-full"
              disabled={pending || !identifier.trim() || !password}
              size="lg"
              type="submit"
              variant="primary"
            >
              {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} strokeWidth={1.75} /> : null}
              {pending ? "Validando…" : "Ingresar"}
            </Button>
          </form>
        </Panel>
      </main>
    </div>
  )
}
