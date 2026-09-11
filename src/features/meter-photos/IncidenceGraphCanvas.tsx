import { useEffect, useRef } from "react"
import { Button } from "@/components/ui"
import { computeLayout, fitTransform, type LaidOutNode } from "./graphLayout"
import type { IncidenceGraph } from "./types"

const COLORS = { estado_conexion: "#7dd3fc", estado_medidor: "#6ee7b7", revision: "#fda4af", etiqueta: "#c4b5fd" }

export function IncidenceGraphCanvas({ graph, selected, onSelect }: { graph: IncidenceGraph; selected: string | null; onSelect: (name: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const reset = useRef<() => void>(() => undefined)
  const redraw = useRef<() => void>(() => undefined)
  const selection = useRef(selected)
  const select = useRef(onSelect)
  useEffect(() => { selection.current = selected; select.current = onSelect; redraw.current() }, [selected, onSelect])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const ctx = element.getContext("2d")
    if (!ctx) return
    const layout = computeLayout(graph, 900, 500)
    const nodes = new Map(layout.nodes.map((node) => [node.id, node]))
    let width = 900, height = 500
    let transform = fitTransform(layout, width, height)
    let dragging: { node: LaidOutNode | null; x: number; y: number; moved: boolean } | null = null
    function draw() {
      if (!ctx) return
      const ratio = window.devicePixelRatio || 1
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.fillStyle = "#11151d"; ctx.fillRect(0, 0, width, height)
      ctx.translate(transform.x, transform.y); ctx.scale(transform.k, transform.k)
      for (const edge of layout.edges) {
        const a = nodes.get(edge.source), b = nodes.get(edge.target)
        if (!a || !b) continue
        ctx.strokeStyle = "#64748b88"; ctx.lineWidth = Math.min(4, 1 + Math.log1p(edge.weight) / 2)
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      for (const node of layout.nodes) {
        ctx.fillStyle = COLORS[node.source]
        ctx.beginPath(); ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2); ctx.fill()
        if (node.id === selection.current) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3 / transform.k; ctx.stroke() }
        ctx.fillStyle = "#11151d"; ctx.textAlign = "center"; ctx.font = "bold 12px sans-serif"
        ctx.fillText(String(node.photoCount), node.x, node.y + 4)
        ctx.font = "12px sans-serif"; ctx.fillStyle = "#e2e8f0"
        const label = node.id.length > 40 ? `${node.id.slice(0, 38)}…` : node.id
        ctx.fillText(label, node.x, node.y + node.radius + 18)
      }
    }
    function resizeAndReset() {
      const bounds = element!.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        width = bounds.width
        height = bounds.height
        element!.width = width * (window.devicePixelRatio || 1)
        element!.height = height * (window.devicePixelRatio || 1)
      }
      transform = fitTransform(layout, width, height)
      draw()
    }
    reset.current = () => { transform = fitTransform(layout, width, height); draw() }
    redraw.current = draw
    resizeAndReset()
    const observer = new ResizeObserver(() => {
      resizeAndReset()
    })
    observer.observe(element)
    function position(event: PointerEvent | WheelEvent) {
      const bounds = element!.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    function down(event: PointerEvent) {
      const point = position(event)
      const x = (point.x - transform.x) / transform.k, y = (point.y - transform.y) / transform.k
      const node = layout.nodes.find((item) => Math.hypot(item.x - x, item.y - y) < item.radius + 8 / transform.k) ?? null
      dragging = { node, ...point, moved: false }; element!.setPointerCapture(event.pointerId)
    }
    function move(event: PointerEvent) {
      if (!dragging) return
      const point = position(event), dx = point.x - dragging.x, dy = point.y - dragging.y
      dragging.moved ||= Math.abs(dx) + Math.abs(dy) > 2
      if (dragging.node) { dragging.node.x += dx / transform.k; dragging.node.y += dy / transform.k }
      else { transform.x += dx; transform.y += dy }
      dragging.x = point.x; dragging.y = point.y; draw()
    }
    function up() { if (dragging?.node && !dragging.moved) select.current(dragging.node.id); dragging = null }
    function cancel() { dragging = null }
    function wheel(event: WheelEvent) {
      event.preventDefault()
      const point = position(event), old = transform.k
      const next = Math.min(5, Math.max(0.15, old * Math.exp(-event.deltaY * 0.001)))
      transform = { k: next, x: point.x - (point.x - transform.x) * next / old, y: point.y - (point.y - transform.y) * next / old }; draw()
    }
    element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move); element.addEventListener("pointerup", up); element.addEventListener("pointercancel", cancel); element.addEventListener("wheel", wheel, { passive: false })
    return () => { redraw.current = () => undefined; observer.disconnect(); element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", cancel); element.removeEventListener("wheel", wheel) }
  }, [graph])
  return <div className="relative overflow-hidden rounded-md border bg-[#11151d]">
    <canvas ref={canvas} className="h-[420px] w-full touch-none" aria-label="Grafo de incidencias. Selecciona una incidencia en la lista para consultar sus fotografías." />
    <Button className="absolute top-3 right-3 bg-background" variant="outline" onClick={() => reset.current()}>Encuadrar</Button>
    <p className="px-3 pb-3 text-xs text-slate-300">Rueda: zoom · Arrastra el fondo o los nodos · Tamaño: cantidad de fotografías</p>
  </div>
}
