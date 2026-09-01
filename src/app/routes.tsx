import { Navigate, type RouteObject } from "react-router"

import { MapToolbar } from "../features/map/MapToolbar"
import { LoginRoute } from "../routes/LoginRoute"
import { MapRoute } from "../routes/MapRoute"
import { ProtectedLayout } from "./ProtectedLayout"
import { SessionProvider } from "./session/SessionProvider"
import { RouteError } from "./shell/RouteError"
import { ThemeProvider } from "./theme/ThemeProvider"

/**
 * Tabla única de rutas. Se exporta por separado de `App` para que las pruebas
 * puedan montarla con `createMemoryRouter` y una historia limpia por caso, en
 * vez de compartir la instancia de router del módulo.
 *
 * Las vistas pesadas van con `lazy` en vez del antiguo patrón de "montar una vez
 * y no desmontar nunca": el reporte arrastra recharts y el taller de indicadores
 * pesa más de mil líneas.
 */
export const routes: RouteObject[] = [
  {
    element: <ThemeProvider />,
    errorElement: <RouteError />,
    children: [
      {
        element: <SessionProvider />,
        children: [
          { path: "/login", element: <LoginRoute /> },
          {
            element: <ProtectedLayout />,
            children: [
              { index: true, element: <Navigate replace to="/mapa" /> },
              {
                path: "dashboard",
                handle: { title: "Dashboard" },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/DashboardRoute")).DashboardRoute }),
              },
              {
                path: "mapa",
                element: <MapRoute />,
                handle: { title: "Mapa", header: () => <MapToolbar />, showsMap: true },
              },
              {
                path: "suministros",
                handle: { title: "Suministros y Medidores" },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/SuppliesRoute")).SuppliesRoute }),
              },
              {
                path: "analisis/alertas",
                handle: { title: "Alertas de consumo", dedicatedMap: true },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/AlertsRoute")).AlertsRoute }),
              },
              {
                path: "analisis/reportes",
                handle: { title: "Análisis de indicadores" },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/ReportsRoute")).ReportsRoute }),
              },
              {
                path: "suministro/:code",
                handle: { title: "Reporte de suministro" },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/SupplyReportRoute")).SupplyReportRoute }),
              },
              {
                path: "cliente-lote/:propertyCode",
                handle: { title: "Reporte de cliente y lote" },
                errorElement: <RouteError />,
                lazy: async () => ({ Component: (await import("../routes/ClientLotReportRoute")).ClientLotReportRoute }),
              },
              { path: "*", element: <Navigate replace to="/mapa" /> },
            ],
          },
        ],
      },
    ],
  },
]
