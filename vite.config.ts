import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(rootDirectory, "src") } },
  clearScreen: false,
  // El worker de gestos se crea con { type: "module" }; el bundle debe salir en ese formato.
  worker: { format: "es" },
  test: {
    environment: "jsdom",
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
})
