import { AlertTriangle, ArrowRight, Bot, Clock3, Database, Expand, History, MapPin, MessageSquarePlus, Send, Shrink, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts"
import { useLocation, useNavigate } from "react-router"

import { Badge, Button } from "@/components/ui"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { friendlyError } from "@/lib/errors"
import { sendAgentMessage } from "@/lib/ipc"
import { useMapData } from "@/features/map/mapDataContext"
import { useSelection } from "@/features/selection/selectionContext"
import { clearConversations, deleteConversation, listConversations, saveConversation } from "./history"
import type { AgentAction, AgentChatMessage, AgentContext, AgentConversation, AgentMode, AgentResponse } from "./types"

const SAMPLE_PROMPTS = [
  "Analiza el suministro seleccionado",
  "¿Qué riesgos de consumo encuentras?",
  "Cruza catastro, operaciones y evidencia",
]

function newConversation(userId: string): AgentConversation {
  const now = Date.now()
  return { id: crypto.randomUUID(), userId, title: "Nueva consulta", createdAt: now, updatedAt: now, messages: [] }
}

function propertyCodeFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/cliente-lote\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function selectedPropertyCode(properties: Record<string, unknown> | undefined): string | undefined {
  const value = properties?.property_code
  return typeof value === "string" && value.trim() ? value : undefined
}

function supplyCodeFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/suministro\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function sourceLabel(status: AgentResponse["sources"][number]["status"]): string {
  if (status === "available") return "Disponible"
  if (status === "empty") return "Sin registros"
  return "No disponible"
}

type PanelPosition = { x: number; y: number }
type PanelSize = { width: number; height: number }

const PANEL_POSITION_KEY = "sedapalgis-agent-panel-position"
const PANEL_SIZE_KEY = "sedapalgis-agent-panel-size"
const PANEL_MIN_WIDTH = 320
const PANEL_MIN_HEIGHT = 360
const PANEL_TOP_MARGIN = 56
const PANEL_EDGE_MARGIN = 8

function clampPanelSize(size: PanelSize): PanelSize {
  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_EDGE_MARGIN * 2)
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_TOP_MARGIN - PANEL_EDGE_MARGIN)
  return {
    width: Math.min(Math.max(size.width, PANEL_MIN_WIDTH), maxWidth),
    height: Math.min(Math.max(size.height, PANEL_MIN_HEIGHT), maxHeight),
  }
}

function clampPanelPosition(position: PanelPosition, size: PanelSize): PanelPosition {
  const maxX = Math.max(PANEL_EDGE_MARGIN, window.innerWidth - size.width - PANEL_EDGE_MARGIN)
  const maxY = Math.max(PANEL_TOP_MARGIN, window.innerHeight - size.height - PANEL_EDGE_MARGIN)
  return { x: Math.min(Math.max(position.x, PANEL_EDGE_MARGIN), maxX), y: Math.min(Math.max(position.y, PANEL_TOP_MARGIN), maxY) }
}

function loadPanelSize(): PanelSize {
  try {
    const raw = window.localStorage.getItem(PANEL_SIZE_KEY)
    if (raw) return clampPanelSize(JSON.parse(raw) as PanelSize)
  } catch { /* localStorage no disponible o valor corrupto: usar default */ }
  return clampPanelSize({ width: 448, height: window.innerHeight - PANEL_TOP_MARGIN - PANEL_EDGE_MARGIN })
}

function loadPanelPosition(size: PanelSize): PanelPosition {
  try {
    const raw = window.localStorage.getItem(PANEL_POSITION_KEY)
    if (raw) return clampPanelPosition(JSON.parse(raw) as PanelPosition, size)
  } catch { /* localStorage no disponible o valor corrupto: usar default */ }
  return clampPanelPosition({ x: window.innerWidth - size.width - 12, y: PANEL_TOP_MARGIN }, size)
}

function AgentResult({ response, onAction }: { response: AgentResponse; onAction: (action: AgentAction) => void }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-xs/relaxed text-foreground">{response.answer}</p>

      {response.findings.length ? (
        <div className="space-y-2">
          {response.findings.map((finding) => (
            <section className="rounded-lg border bg-muted/20 p-2.5" key={`${finding.title}-${finding.summary}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{finding.title}</span>
                <Badge tone={finding.severity === "high" || finding.severity === "critical" ? "warning" : "neutral"}>
                  {finding.severity}
                </Badge>
              </div>
              <p className="text-[11px]/relaxed text-muted-foreground">{finding.summary}</p>
            </section>
          ))}
        </div>
      ) : null}

      {response.charts.map((chart) => (
        <section className="rounded-lg border p-2.5" key={`${chart.title}-${chart.xKey}-${chart.yKey}`}>
          <h4 className="mb-2 text-[11px] font-semibold">{chart.title}</h4>
          <div className="h-36 w-full">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={chart.data} margin={{ bottom: 0, left: -24, right: 8, top: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey={chart.xKey} fontSize={9} minTickGap={20} stroke="var(--muted-foreground)" />
                <YAxis fontSize={9} stroke="var(--muted-foreground)" />
                <ChartTooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                <Line dataKey={chart.yKey} dot={false} stroke="var(--primary)" strokeWidth={2} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ))}

      {response.sources.length ? (
        <section className="rounded-lg border p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
            <Database aria-hidden="true" className="size-3.5" /> Fuentes consultadas
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {response.sources.map((source) => (
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/35 px-2 py-1.5 text-[10px]" key={source.id}>
                <span className="truncate">{source.label}</span>
                <span className="shrink-0 text-muted-foreground">{sourceLabel(source.status)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {response.actions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {response.actions.map((action) => (
            <Button key={`${action.type}-${action.label}`} onClick={() => onAction(action)} size="sm" variant="outline">
              {action.type === "focus_map" || action.type === "set_district" ? <MapPin aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}

      {response.limitations.length ? (
        <div className="space-y-1 rounded-lg border border-amber-600/25 bg-amber-500/5 p-2.5 text-[10px]/relaxed text-amber-800 dark:text-amber-300">
          {response.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
        </div>
      ) : null}

      <p className="text-[9px] text-muted-foreground">Ref. {response.analysisId.slice(0, 8)} · {response.toolCount} fuentes · {response.modelUsed ? "síntesis IA" : "síntesis segura"}</p>
    </div>
  )
}

export function AgentPanel({ onClose, userId }: { onClose: () => void; userId: string }): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const { activeLayers, districtOptions, getViewContext, selectDistrict, selectedDistrict } = useMapData()
  const { cadastralSelection, searchSupply, selectedSupply } = useSelection()
  const [mode, setMode] = useState<AgentMode>("quick")
  const [input, setInput] = useState("")
  const [conversation, setConversation] = useState(() => newConversation(userId))
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<PanelSize>(() => loadPanelSize())
  const [position, setPosition] = useState<PanelPosition>(() => loadPanelPosition(size))
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const onResize = () => {
      setSize((currentSize) => {
        const nextSize = clampPanelSize(currentSize)
        setPosition((currentPosition) => clampPanelPosition(currentPosition, nextSize))
        return nextSize
      })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (expanded || (event.target as HTMLElement).closest("button")) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const originX = position.x
    const originY = position.y
    document.body.classList.add("select-none")
    const onMove = (moveEvent: PointerEvent) => {
      setPosition(clampPanelPosition({ x: originX + (moveEvent.clientX - startX), y: originY + (moveEvent.clientY - startY) }, size))
    }
    const onUp = () => {
      document.body.classList.remove("select-none")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setPosition((current) => {
        try { window.localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(current)) } catch { /* localStorage no disponible */ }
        return current
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [expanded, position, size])

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (expanded) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const originWidth = size.width
    const originHeight = size.height
    document.body.classList.add("select-none")
    const onMove = (moveEvent: PointerEvent) => {
      const nextSize = clampPanelSize({ width: originWidth + (moveEvent.clientX - startX), height: originHeight + (moveEvent.clientY - startY) })
      setSize(nextSize)
      setPosition((currentPosition) => clampPanelPosition(currentPosition, nextSize))
    }
    const onUp = () => {
      document.body.classList.remove("select-none")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setSize((current) => {
        try { window.localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(current)) } catch { /* localStorage no disponible */ }
        return current
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [expanded, size])

  const refreshHistory = useCallback(async () => {
    setConversations(await listConversations(userId))
  }, [userId])

  useEffect(() => {
    void refreshHistory().catch(() => setError("No se pudo abrir el historial local."))
  }, [refreshHistory])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversation.messages, sending])

  const context = useMemo<AgentContext>(() => {
    const view = getViewContext()
    const propertyCode = selectedPropertyCode(cadastralSelection?.properties)
    return {
      route: location.pathname,
      supplyCode: selectedSupply?.supply.code ?? supplyCodeFromPath(location.pathname),
      propertyCode: propertyCodeFromPath(location.pathname) ?? propertyCode,
      district: selectedDistrict?.name ?? selectedSupply?.hierarchy.district ?? undefined,
      bbox: view?.bbox,
      zoom: view?.zoom,
      activeLayers: [...activeLayers],
    }
  }, [activeLayers, cadastralSelection?.properties, getViewContext, location.pathname, selectedDistrict?.name, selectedSupply])

  const persist = useCallback(async (next: AgentConversation) => {
    const saved = await saveConversation(next)
    setConversation(saved)
    await refreshHistory()
  }, [refreshHistory])

  const send = useCallback(async (prompt: string) => {
    const message = prompt.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    setInput("")
    const userMessage: AgentChatMessage = { id: crypto.randomUUID(), role: "user", text: message, createdAt: Date.now() }
    const pending: AgentConversation = {
      ...conversation,
      title: conversation.messages.length ? conversation.title : message.slice(0, 80),
      messages: [...conversation.messages, userMessage],
      updatedAt: Date.now(),
    }
    setConversation(pending)
    try {
      const response = await sendAgentMessage({
        message,
        mode,
        context,
        history: conversation.messages.slice(-10).map((item) => ({ role: item.role, text: item.text })),
      })
      const assistant: AgentChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.answer,
        createdAt: Date.now(),
        response,
      }
      await persist({ ...pending, messages: [...pending.messages, assistant] })
    } catch (reason) {
      setError(friendlyError(reason))
      await persist(pending).catch(() => undefined)
    } finally {
      setSending(false)
    }
  }, [context, conversation, mode, persist, sending])

  const handleAction = useCallback((action: AgentAction) => {
    const supplyCode = typeof action.payload.supplyCode === "string" ? action.payload.supplyCode : undefined
    if (action.type === "open_supply" && supplyCode) {
      navigate(`/suministro/${encodeURIComponent(supplyCode)}`)
      return
    }
    if (action.type === "open_property_report" && typeof action.payload.propertyCode === "string") {
      navigate(`/cliente-lote/${encodeURIComponent(action.payload.propertyCode)}`)
      return
    }
    if (action.type === "set_district" && typeof action.payload.district === "string") {
      const target = districtOptions.find((item) => item.name.localeCompare(action.payload.district as string, undefined, { sensitivity: "base" }) === 0)
      if (target) selectDistrict(target)
      navigate("/mapa")
      return
    }
    if (action.type === "focus_map" && supplyCode) {
      navigate("/mapa")
      void searchSupply(supplyCode)
    }
  }, [districtOptions, navigate, searchSupply, selectDistrict])

  const startNew = useCallback(() => {
    setConversation(newConversation(userId))
    setShowHistory(false)
    setError(null)
  }, [userId])

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversation(id, userId)
    if (conversation.id === id) setConversation(newConversation(userId))
    await refreshHistory()
  }, [conversation.id, refreshHistory, userId])

  const clearHistory = useCallback(async () => {
    await clearConversations(userId)
    setConversation(newConversation(userId))
    setConversations([])
  }, [userId])

  return (
    <aside
      aria-label="Agente GIS"
      className={`fixed z-40 flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xl ${expanded ? "inset-x-2 bottom-2 top-14" : ""}`}
      style={expanded ? undefined : { left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <header className="flex h-12 shrink-0 cursor-move touch-none items-center justify-between gap-2 border-b px-3" onPointerDown={handleHeaderPointerDown}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Bot aria-hidden="true" className="size-4" /></span>
          <div className="min-w-0">
            <h2 className="truncate text-xs font-semibold">Agente GIS</h2>
            <p className="truncate text-[10px] text-muted-foreground">Análisis GIS y visión 360</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button aria-label="Nueva conversación" onClick={startNew} size="icon-sm" variant="ghost"><MessageSquarePlus aria-hidden="true" /></Button>
          <Button aria-label="Ver historial" aria-pressed={showHistory} onClick={() => setShowHistory((current) => !current)} size="icon-sm" variant="ghost"><History aria-hidden="true" /></Button>
          <Button aria-label={expanded ? "Restaurar tamaño" : "Expandir panel"} onClick={() => setExpanded((current) => !current)} size="icon-sm" variant="ghost">{expanded ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}</Button>
          <Button aria-label="Cerrar agente" onClick={onClose} size="icon-sm" variant="ghost"><X aria-hidden="true" /></Button>
        </div>
      </header>

      {showHistory ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Historial local</span>
              <Button disabled={!conversations.length} onClick={() => void clearHistory()} size="xs" variant="destructive"><Trash2 aria-hidden="true" /> Borrar historial</Button>
            </div>
            {conversations.length ? conversations.map((item) => (
              <div className="flex items-center gap-2 rounded-lg border p-2" key={item.id}>
                <Button className="h-auto min-w-0 flex-1 justify-start px-1 py-1 text-left" onClick={() => { setConversation(item); setShowHistory(false) }} variant="ghost">
                  <Clock3 aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0"><span className="block truncate">{item.title}</span><span className="block text-[9px] font-normal text-muted-foreground">{new Date(item.updatedAt).toLocaleString()}</span></span>
                </Button>
                <Button aria-label={`Eliminar ${item.title}`} onClick={() => void removeConversation(item.id)} size="icon-xs" variant="ghost"><Trash2 aria-hidden="true" /></Button>
              </div>
            )) : <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">Todavía no hay conversaciones guardadas.</p>}
          </div>
        </ScrollArea>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex rounded-md border bg-muted/30 p-0.5">
              <Button aria-pressed={mode === "quick"} onClick={() => setMode("quick")} size="xs" variant={mode === "quick" ? "secondary" : "ghost"}>Rápido</Button>
              <Button aria-pressed={mode === "deep"} onClick={() => setMode("deep")} size="xs" variant={mode === "deep" ? "secondary" : "ghost"}>Profundo</Button>
            </div>
            <span className="max-w-48 truncate text-[9px] text-muted-foreground">{context.supplyCode ? `NIS ${context.supplyCode}` : context.district ?? "Contexto general"}</span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-3">
              {!conversation.messages.length ? (
                <div className="grid min-h-64 place-items-center py-8 text-center">
                  <div className="max-w-xs space-y-3">
                    <Bot aria-hidden="true" className="mx-auto size-8 text-primary" />
                    <div><h3 className="text-xs font-semibold">Consulta el contexto actual</h3><p className="mt-1 text-[11px]/relaxed text-muted-foreground">El agente cruza consumo, catastro, operaciones y evidencia sin modificar datos.</p></div>
                    <div className="space-y-1.5">
                      {SAMPLE_PROMPTS.map((prompt) => <Button className="w-full justify-between" disabled={sending} key={prompt} onClick={() => void send(prompt)} size="sm" variant="outline">{prompt}<ArrowRight aria-hidden="true" /></Button>)}
                    </div>
                  </div>
                </div>
              ) : conversation.messages.map((message) => (
                <article className={message.role === "user" ? "ml-8 rounded-xl bg-primary px-3 py-2 text-primary-foreground" : "mr-2 rounded-xl border bg-card p-3"} key={message.id}>
                  {message.role === "assistant" && message.response ? <AgentResult onAction={handleAction} response={message.response} /> : <p className="whitespace-pre-wrap text-xs/relaxed">{message.text}</p>}
                </article>
              ))}
              {sending ? <div className="mr-12 flex items-center gap-2 rounded-xl border bg-card p-3 text-xs text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary" />{mode === "deep" ? "Contrastando fuentes…" : "Consultando datos…"}</div> : null}
              {error ? <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] text-destructive"><AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{error}</div> : null}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          <form className="flex shrink-0 items-center gap-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); void send(input) }}>
            <Input aria-label="Consulta para el agente GIS" className="h-8" disabled={sending} maxLength={1000} onChange={(event) => setInput(event.target.value)} placeholder={mode === "deep" ? "Solicita un análisis profundo…" : "Pregunta por el contexto actual…"} value={input} />
            <Button aria-label="Enviar consulta" disabled={sending || !input.trim()} size="icon-lg" type="submit"><Send aria-hidden="true" /></Button>
          </form>
        </>
      )}

      {!expanded ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 size-4 touch-none cursor-nwse-resize"
          onPointerDown={handleResizePointerDown}
        >
          <svg className="size-full p-0.5 text-muted-foreground/50" fill="none" viewBox="0 0 16 16">
            <path d="M13 3L3 13M13 8L8 13M13 13L13 13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
        </div>
      ) : null}
    </aside>
  )
}
