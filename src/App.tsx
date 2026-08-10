import { createHashRouter, RouterProvider } from "react-router"

import { routes } from "./app/routes"

/**
 * Router de hash y no de history: en producción Tauri sirve `dist/` a través de
 * su protocolo de assets, donde una ruta como `/analisis/reportes` no existe
 * como archivo y la ventana quedaría en blanco al recargar. Con hash el
 * documento servido siempre es `index.html`. La ventana no tiene barra de
 * direcciones, así que el `#` no se ve.
 */
const router = createHashRouter(routes)

export function App(): React.JSX.Element {
  return <RouterProvider router={router} />
}
