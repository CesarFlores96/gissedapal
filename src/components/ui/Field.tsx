import type { InputHTMLAttributes, ReactNode, Ref } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldSize = "sm" | "md" | "lg"

// Misma escala que Button/IconButton (sm=8, md=9, lg=10), para que un input y
// un botón vecinos en la misma fila queden a la misma altura sin adivinar.
const sizes: Record<FieldSize, string> = { sm: "h-8", md: "h-9", lg: "h-10" }

type FieldProps = {
  /** Alto del control (no confundir con el atributo nativo `size` de `<input>`, que es numérico). */
  controlSize?: FieldSize
  /** Icono decorativo anclado a la izquierda; recibe el color apagado. */
  icon?: ReactNode
  /** Etiqueta accesible. Se oculta visualmente salvo que `showLabel` sea true. */
  label: string
  ref?: Ref<HTMLInputElement>
  showLabel?: boolean
  wrapperClassName?: string
} & InputHTMLAttributes<HTMLInputElement>

/** Input de una línea con icono, usado por las búsquedas de NIS y de catastro. */
export function Field({
  className = "",
  controlSize = "md",
  icon,
  label,
  ref,
  showLabel = false,
  wrapperClassName = "",
  ...rest
}: FieldProps): React.JSX.Element {
  return (
    <Label className={cn("relative block min-w-0", wrapperClassName)}>
      <span className={showLabel ? "mb-1.5 block text-xs font-medium text-muted-foreground" : "sr-only"}>{label}</span>
      {icon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground [&>svg]:block"
          style={showLabel ? { top: "calc(50% + 0.65rem)" } : undefined}
        >
          {icon}
        </span>
      ) : null}
      <Input
        className={cn(sizes[controlSize], icon ? "pl-8" : "pl-3", className)}
        ref={ref}
        {...rest}
      />
    </Label>
  )
}
