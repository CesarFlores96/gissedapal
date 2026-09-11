import type { ReactNode } from "react"
import { Button } from "@/components/ui"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={`rounded-md border p-3 text-sm break-words ${error ? "border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted/40 text-muted-foreground"}`}>{children}</div>
}

export function Pager({ page, total, size = 50, onPage }: { page: number; total: number; size?: number; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3 py-3 text-xs text-muted-foreground">
    <span>{total.toLocaleString("es-PE")} registros · Página {page} de {Math.max(1, Math.ceil(total / size))}</span>
    <div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button><Button variant="outline" disabled={page * size >= total} onClick={() => onPage(page + 1)}>Siguiente</Button></div>
  </div>
}

export function Choice({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <Label className="flex min-w-0 flex-col items-start gap-1.5 text-xs text-muted-foreground">{label}
    <Select value={value} onValueChange={(next) => { if (next !== null) onChange(next) }}>
      <SelectTrigger className="w-full min-w-36"><SelectValue>{options.find((item) => item.value === value)?.label}</SelectValue></SelectTrigger>
      <SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  </Label>
}
