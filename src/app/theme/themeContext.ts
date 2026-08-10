import { createContext, use } from "react"

export type ThemeName = "dark" | "light"

export type ThemeValue = {
  theme: ThemeName
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeValue | null>(null)

export function useTheme(): ThemeValue {
  const value = use(ThemeContext)
  if (!value) throw new Error("useTheme debe usarse dentro de <ThemeProvider>.")
  return value
}
