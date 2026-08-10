import { useNavigation } from "react-router"

/**
 * Barra celeste de 2px mientras react-router resuelve una ruta perezosa. Sin
 * ella, pulsar "Reportes" no da ninguna señal hasta que el chunk (con recharts
 * dentro) termina de descargarse.
 */
export function NavigationProgress(): React.JSX.Element | null {
  const navigation = useNavigation()
  if (navigation.state === "idle") return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-sidebar-primary" />
      <style>{"@keyframes indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}"}</style>
    </div>
  )
}
