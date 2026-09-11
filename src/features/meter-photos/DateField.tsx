import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Selector de fecha del módulo, con el calendario del sistema de diseño.
 *
 * El valor que entra y sale es siempre `AAAA-MM-DD`, que es lo que espera el
 * backend; la fecha con formato local solo se usa para mostrar.
 */

/**
 * Convierte `AAAA-MM-DD` a `Date` **en horario local**.
 *
 * `new Date("2026-09-11")` interpreta la cadena como UTC, así que en Lima
 * (UTC-5) devuelve el 10 de septiembre a las 19:00 y el calendario resalta el
 * día anterior al elegido. Construirla por partes evita ese corrimiento.
 */
function desdeISO(value: string): Date | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!partes) return undefined
  return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]))
}

/** Y la vuelta: se arma con los componentes locales, nunca con `toISOString()`. */
function haciaISO(date: Date): string {
  const mes = String(date.getMonth() + 1).padStart(2, "0")
  const dia = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${mes}-${dia}`
}

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  className?: string
}) {
  const seleccionada = desdeISO(value)
  const desde = min ? desdeISO(min) : undefined
  const hasta = max ? desdeISO(max) : undefined
  // `{ before }` y `{ after }` son matchers separados: pasarlos con `undefined`
  // dentro de un solo objeto no es un matcher válido.
  const bloqueados = [...(desde ? [{ before: desde }] : []), ...(hasta ? [{ after: hasta }] : [])]

  return (
    <Label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={cn("h-9 w-full justify-start gap-2 font-normal", !seleccionada && "text-muted-foreground")}
            >
              <CalendarDays data-icon="inline-start" />
              {seleccionada ? seleccionada.toLocaleDateString("es-PE") : "Cualquiera"}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={seleccionada}
            defaultMonth={seleccionada}
            // El rango inválido no se puede ni elegir: cada extremo acota al otro.
            disabled={bloqueados.length > 0 ? bloqueados : undefined}
            onSelect={(date) => onChange(date ? haciaISO(date) : "")}
          />
          {value ? (
            <div className="border-t p-2">
              <Button type="button" variant="ghost" className="w-full" onClick={() => onChange("")}>
                Quitar fecha
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </Label>
  )
}
