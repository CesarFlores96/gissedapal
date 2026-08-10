import { useCallback, useEffect, useMemo, useState } from "react"
import { Outlet } from "react-router"

import { ThemeContext, type ThemeName } from "./themeContext"

const STORAGE_KEY = "sedapalgis-theme"

/**
 * Vive por encima del gate de sesión para que el login también quede tematizado.
 * Se marcan `data-theme` y la clase `.dark` a la vez: la primera la consultan
 * algunos estilos de MapLibre, la segunda es la que activa el variante de
 * Tailwind (`@custom-variant dark`).
 */
export function ThemeProvider(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeName>(
    () => window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light",
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle("dark", theme === "dark")
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === "dark" ? "light" : "dark")
  }, [])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return (
    <ThemeContext value={value}>
      <Outlet />
    </ThemeContext>
  )
}
