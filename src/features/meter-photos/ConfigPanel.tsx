import { useEffect, useState, type ReactNode } from "react"
import { useSession } from "@/app/session/sessionContext"
import { Button, Field } from "@/components/ui"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { meterApi, meterError } from "./api"
import { Choice, Notice } from "./shared"
import { ReportFields } from "./PhotoReportDialog"
import type { MeterConfigBundle, MeterLabel, MeterRule, MeterReport, PromptTemplate } from "./types"

function TextArea({ label, value, onChange, rows = 4, readOnly }: { label: string; value: string; onChange: (value: string) => void; rows?: number; readOnly?: boolean }) {
  return <Label className="flex flex-col items-stretch gap-1.5 text-xs text-muted-foreground">{label}<textarea readOnly={readOnly} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 read-only:opacity-85" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></Label>
}

export function ConfigPanel({ config, onSaved }: { config: MeterConfigBundle; onSaved: () => Promise<void> }) {
  const { isReadOnly } = useSession()
  const [section, setSection] = useState("ollama")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  async function save(action: () => Promise<unknown>, message = "Cambios guardados.") {
    if (isReadOnly) return
    setBusy(true); setError(null); setStatus(null)
    try { await action(); await onSaved(); setStatus(message) }
    catch (err) { setError(meterError(err)) }
    finally { setBusy(false) }
  }
  return <div className="max-w-4xl space-y-4">
    <div className="flex flex-wrap gap-2">{[["ollama", "Conexión de IA"], ["labels", "Etiquetas"], ["rules", "Reglas"], ["prompts", "Prompts"], ["export", "Excel"]].map(([value, label]) => <Button key={value} variant={section === value ? "secondary" : "ghost"} onClick={() => setSection(value)}>{label}</Button>)}</div>
    {isReadOnly && <Notice>Modo solo consulta: puedes consultar y probar los modelos, pero no modificar prompts, reglas ni configuración.</Notice>}
    {error && <Notice error>{error}</Notice>}{status && <Notice>{status}</Notice>}
    <fieldset disabled={busy} className="min-w-0">
      {section === "ollama" && <OllamaForm config={config} save={save} isReadOnly={isReadOnly} />}
      {section === "labels" && <CatalogForm kind="labels" save={save} isReadOnly={isReadOnly} />}
      {section === "rules" && <CatalogForm kind="rules" save={save} isReadOnly={isReadOnly} />}
      {section === "prompts" && <PromptForm config={config} save={save} isReadOnly={isReadOnly} />}
      {section === "export" && <ExportForm config={config} save={save} isReadOnly={isReadOnly} />}
    </fieldset>
    {busy && <p role="status" className="text-xs text-muted-foreground">Guardando o comprobando la configuración…</p>}
  </div>
}

type Save = (action: () => Promise<unknown>, message?: string) => Promise<void>
function OllamaForm({ config, save, isReadOnly }: { config: MeterConfigBundle; save: Save; isReadOnly: boolean }) {
  const c = config.ollama
  const [model, setModel] = useState(c.model)
  const [key, setKey] = useState("")
  const [replacing, setReplacing] = useState(false)
  const [temperature, setTemperature] = useState(c.temperature)
  const [timeout, setTimeout] = useState(c.timeout_seconds)
  const [concurrency, setConcurrency] = useState(c.concurrency)
  const [side, setSide] = useState(c.max_image_side)
  const [quality, setQuality] = useState(c.jpeg_quality)
  const settings = { host: "https://ollama.com", model, temperature, timeoutSeconds: timeout, concurrency, maxImageSide: side, jpegQuality: quality }
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const entered = key; setKey(""); setReplacing(false); void save(() => meterApi.saveOllama(settings, entered)) }}>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Servicio" showLabel value="https://ollama.com" readOnly /><Field label="Modelo" showLabel value={model} required maxLength={160} onChange={(event) => setModel(event.target.value)} /></div>
    {/* Con clave guardada se muestra solo su huella (prefijo y últimos cuatro),
        que es lo único que el servidor expone: el valor real nunca llega acá.
        El campo enmascarado es de solo lectura a propósito, para que no se
        pueda reenviar la huella creyendo que es la clave. */}
    {c.hasApiKey && !replacing
      ? <div className="flex items-end gap-2">
          <Field label="Clave de API" showLabel readOnly value={c.api_key_hint ?? "••••••••"} wrapperClassName="flex-1" />
          <Button type="button" variant="outline" onClick={() => { setReplacing(true); setKey("") }}>Cambiar</Button>
        </div>
      : <div className="flex items-end gap-2">
          <Field label={`Clave de API${c.hasApiKey ? "" : " · Sin configurar"}`} showLabel type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Pega aquí la clave del servicio de IA" wrapperClassName="flex-1" />
          {c.hasApiKey && <Button type="button" variant="ghost" onClick={() => { setReplacing(false); setKey("") }}>Cancelar</Button>}
        </div>}
    <p className="text-xs text-muted-foreground">Se guarda cifrada en el servidor y queda disponible para todas las computadoras: basta configurarla una vez. Las fotografías se analizan desde cada equipo y no se suben al servidor.</p>
    <div className="grid gap-4 sm:grid-cols-3">
      <NumberField label="Temperatura" value={temperature} min={0} max={1} step={0.05} onChange={setTemperature} />
      <NumberField label="Tiempo máximo por foto (s)" value={timeout} min={10} max={600} onChange={setTimeout} />
      <NumberField label="Fotografías en paralelo" value={concurrency} min={1} max={8} onChange={setConcurrency} />
      <NumberField label="Lado máximo de imagen (px)" value={side} min={512} max={3000} onChange={setSide} />
      <NumberField label="Calidad de envío (%)" value={quality} min={40} max={100} onChange={setQuality} />
    </div>
    <p className="text-xs text-muted-foreground">Con 1 fotografía en paralelo, la cola procesa una imagen por vez.</p>
    <div className="flex flex-wrap gap-2">
      {!isReadOnly && <Button type="submit">Guardar conexión</Button>}
      <Button type="button" variant="outline" disabled={!c.canDecrypt} onClick={() => { void save(meterApi.testConnection, "Ollama respondió correctamente con la configuración guardada.") }}>Probar conexión guardada</Button>
    </div>
  </form>
}

function NumberField({ label, value, min, max, onChange, step = 1, readOnly }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; readOnly?: boolean }) {
  return <Field label={label} showLabel type="number" required min={min} max={max} step={step} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.valueAsNumber)} />
}

function CatalogForm({ kind, save, isReadOnly }: { kind: "labels" | "rules"; save: Save; isReadOnly: boolean }) {
  const [labels, setLabels] = useState<MeterLabel[]>([])
  const [rules, setRules] = useState<MeterRule[]>([])
  const [id, setId] = useState<string | undefined>()
  const [text, setText] = useState("")
  const [description, setDescription] = useState("")
  const [order, setOrder] = useState(100)
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isLabel = kind === "labels"
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  async function reload() {
    if (isLabel) setLabels((await meterApi.labels()).data)
    else setRules((await meterApi.rules()).data)
  }
  useEffect(() => {
    let current = true
    if (isLabel) void meterApi.labels().then((value) => { if (current) setLabels(value.data) }).catch((err: unknown) => { if (current) setError(meterError(err)) })
    else void meterApi.rules().then((value) => { if (current) setRules(value.data) }).catch((err: unknown) => { if (current) setError(meterError(err)) })
    return () => { current = false }
  }, [isLabel])
  function clear() { setId(undefined); setText(""); setDescription(""); setOrder(100); setActive(true) }
  const items = isLabel ? labels.map((row) => ({ id: row.id, text: row.name, description: row.description, order: row.sort_order, active: row.is_active })) : rules.map((row) => ({ id: row.id, text: row.content, description: null, order: row.priority, active: row.is_active }))
  return <div className="space-y-4">
    {error && <Notice error>{error}</Notice>}
    {!isReadOnly && (
      <form className="space-y-3 rounded-md border p-4" onSubmit={(event) => { event.preventDefault(); void save(async () => { if (isLabel) await meterApi.saveLabel({ id, name: text, description, sortOrder: order, isActive: active }); else await meterApi.saveRule({ id, content: text, priority: order, isActive: active }); await reload(); clear() }) }}>
        {isLabel ? <Field label="Nombre de etiqueta" showLabel required value={text} maxLength={160} onChange={(event) => setText(event.target.value)} /> : <TextArea label="Contenido de la regla" value={text} onChange={setText} />}
        {isLabel && <TextArea label="Descripción" value={description} onChange={setDescription} rows={2} />}
        <div className="flex flex-wrap items-end gap-4"><NumberField label={isLabel ? "Orden" : "Prioridad"} value={order} min={0} max={10000} onChange={setOrder} /><Label className="gap-2 pb-2"><Checkbox checked={active} onCheckedChange={(value) => setActive(Boolean(value))} />Activa</Label></div>
        <div className="flex gap-2"><Button type="submit" disabled={!text.trim()}>{id ? "Guardar cambios" : isLabel ? "Agregar etiqueta" : "Agregar regla"}</Button>{id && <Button variant="ghost" type="button" onClick={clear}>Cancelar edición</Button>}</div>
      </form>
    )}
    <div className="max-h-96 divide-y overflow-y-auto rounded-md border">{items.map((row) => <div key={row.id} className="flex items-start gap-3 p-3"><div className="min-w-0 flex-1"><p className="break-words text-sm">{row.text}</p><p className="text-xs text-muted-foreground">{row.active ? "Activa" : "Inactiva"} · {row.order}{row.description ? ` · ${row.description}` : ""}</p></div>{!isReadOnly && <div className="flex shrink-0 gap-2"><Button variant="outline" onClick={() => { setId(row.id); setText(row.text); setDescription(row.description ?? ""); setOrder(row.order); setActive(row.active) }}>Editar</Button>{confirmingId === row.id ? <><Button variant="destructive" onClick={() => { setConfirmingId(null); void save(async () => { if (isLabel) await meterApi.deleteLabel(row.id); else await meterApi.deleteRule(row.id); if (id === row.id) clear(); await reload() }, isLabel ? "Etiqueta eliminada." : "Regla eliminada.") }}>Confirmar</Button><Button variant="ghost" onClick={() => setConfirmingId(null)}>Cancelar</Button></> : <Button variant="ghost" onClick={() => setConfirmingId(row.id)}>Eliminar</Button>}</div>}</div>)}</div>
  </div>
}

function PromptForm({ config, save, isReadOnly }: { config: MeterConfigBundle; save: Save; isReadOnly: boolean }) {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [name, setName] = useState(config.activePrompt?.name ?? "Medidores")
  const [body, setBody] = useState(config.activePrompt?.body ?? "")
  const [active, setActive] = useState(true)
  const [testFiles, setTestFiles] = useState<{ value: string; label: string }[]>([])
  const [path, setPath] = useState("")
  const [report, setReport] = useState<MeterReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let current = true; void meterApi.prompts().then((value) => { if (current) setPrompts(value.data) }).catch((err: unknown) => { if (current) setError(meterError(err)) }); return () => { current = false } }, [config])
  const tokensPresent = body.includes("{{etiquetas}}") && body.includes("{{reglas}}")
  return <div className="space-y-4">
    {error && <Notice error>{error}</Notice>}
    <Notice>{isReadOnly ? "Modo solo consulta: no tienes permisos para crear, editar o activar prompts." : "Al guardar se crea una nueva versión. Cada ejecución conserva el prompt que utilizó."}</Notice>
    <Field label="Nombre del prompt" showLabel value={name} readOnly={isReadOnly} onChange={(event) => setName(event.target.value)} />
    <TextArea label="Prompt base" rows={16} value={body} readOnly={isReadOnly} onChange={setBody} />
    {!tokensPresent && <Notice error>Incluye {"{{etiquetas}}"} y {"{{reglas}}"} para insertar la configuración activa.</Notice>}
    {!isReadOnly && (
      <>
        <Label className="gap-2 text-xs"><Checkbox checked={active} onCheckedChange={(value) => setActive(Boolean(value))} />Activar la nueva versión al guardar</Label>
        <Button disabled={!tokensPresent || !name.trim()} onClick={() => { void save(() => meterApi.savePrompt({ name, body, activate: active })) }}>Guardar nueva versión</Button>
      </>
    )}
    <div className="max-h-52 divide-y overflow-auto rounded-md border">{prompts.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 p-3"><span className="flex-1 text-sm">{item.name} · v{item.version}{item.is_active ? " · Activo" : ""}</span><Button variant="ghost" onClick={() => { setName(item.name); setBody(item.body) }}>Ver {isReadOnly ? "prompt" : "/ editar"}</Button><Button variant="outline" disabled={isReadOnly || item.is_active} onClick={() => { void save(() => meterApi.activatePrompt(item.id)) }}>Activar</Button></div>)}</div>
    <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">Probar este prompt</h3><p className="text-xs text-muted-foreground">La fotografía seleccionada se enviará a Ollama. Esta prueba no agrega filas a una ejecución.</p>
      <Button variant="outline" onClick={() => { void save(async () => { const folder = await meterApi.pickFolder(); if (!folder) return; const scan = await meterApi.sample(folder); const files = scan.files.map((file) => ({ value: file.filePath, label: file.fileName })); setTestFiles(files); setPath(files[0]?.value ?? "") }, "Carpeta de prueba seleccionada.") }}>Seleccionar carpeta de prueba</Button>
      {testFiles.length > 0 && <Choice label="Fotografía de prueba" value={path} options={testFiles} onChange={setPath} />}
      <Button disabled={!path || !tokensPresent || !config.ollama.canDecrypt} onClick={() => { void save(async () => setReport(await meterApi.testPrompt(path, body)), "Prueba completada.") }}>Analizar fotografía de prueba</Button>
      {report && <ReportFields report={report} />}
    </section>
  </div>
}

function ExportForm({ config, save, isReadOnly }: { config: MeterConfigBundle; save: Save; isReadOnly: boolean }) {
  const profile = config.exportProfile
  const [name, setName] = useState(profile?.sheet_name ?? "Analisis")
  const [freeze, setFreeze] = useState(profile?.freeze_header ?? true)
  const [filter, setFilter] = useState(profile?.autofilter ?? true)
  const check = (label: ReactNode, value: boolean, set: (value: boolean) => void) => <Label className="gap-2 text-sm"><Checkbox checked={value} disabled={isReadOnly} onCheckedChange={(next) => set(Boolean(next))} />{label}</Label>
  return <div className="space-y-4">
    <Field label="Nombre de la hoja" showLabel value={name} maxLength={31} readOnly={isReadOnly} onChange={(event) => setName(event.target.value)} />
    {check("Inmovilizar encabezados", freeze, setFreeze)}
    {check("Habilitar filtros", filter, setFilter)}
    <Notice>Se incluyen las diez columnas del informe y una fila por fotografía procesada, también las que terminaron con error. Lecturas y números de medidor se conservan como texto.</Notice>
    {!isReadOnly && <Button disabled={!name.trim() || !profile} onClick={() => { void save(() => meterApi.saveExport({ sheetName: name, freezeHeader: freeze, autofilter: filter, includeErrorRows: true, columns: profile?.columns })) }}>Guardar formato Excel</Button>}
  </div>
}
