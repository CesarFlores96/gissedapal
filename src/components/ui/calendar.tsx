import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { es } from "react-day-picker/locale"

import { cn } from "@/lib/utils"

/**
 * Calendario del sistema de diseño, sobre `react-day-picker`.
 *
 * Existe porque el `<input type="date">` nativo del webview ignora el tema, la
 * tipografía y el idioma de la aplicación: aparecía en blanco sobre las vistas
 * oscuras y con otro juego de colores. Acá todo sale de los mismos tokens que
 * el resto de la interfaz, así que sigue al modo claro y oscuro sin esfuerzo.
 *
 * El CLI de shadcn no pudo generarlo sin pisar `button.tsx`, que en este
 * proyecto tiene variantes propias; por eso se escribe a mano en vez de
 * aceptar la sobrescritura.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={es}
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-3",
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium capitalize",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        button_next:
          "absolute right-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-8 text-[0.7rem] font-normal text-muted-foreground uppercase",
        week: "mt-1 flex w-full",
        day: "relative size-8 p-0 text-center text-sm",
        day_button:
          "size-8 rounded-md font-normal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90",
        today: "[&>button]:border [&>button]:border-primary/50",
        // Los días de los meses vecinos se atenúan en vez de ocultarse: dan
        // continuidad a la cuadrícula sin competir con el mes en foco.
        outside: "[&>button]:text-muted-foreground/40",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
      }}
      {...props}
    />
  )
}
