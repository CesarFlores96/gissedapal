import type { ButtonHTMLAttributes, ReactNode } from "react"

import { Button } from "./Button"

type IconButtonProps = {
  icon: ReactNode
  /** Se usa como `aria-label` y como `title`: estos botones nunca llevan texto. */
  label: string
  size?: "sm" | "md"
  variant?: "outline" | "ghost"
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title">

/**
 * Botón cuadrado de solo icono. Promueve el `IconActionButton` que vivía dentro
 * de InspectorDrawer para que toolbar, cabecera e inspector compartan acabado.
 */
export function IconButton({
  className = "",
  icon,
  label,
  size = "md",
  type = "button",
  variant = "outline",
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <Button
      aria-label={label}
      className={className}
      size={size === "sm" ? "icon-sm" : "icon"}
      title={label}
      type={type}
      variant={variant}
      {...rest}
    >
      {icon}
    </Button>
  )
}
