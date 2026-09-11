import { Check, ChevronDown, ChevronRight, Copy, Globe, Layers, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

import { Button } from "../../components/ui/Button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { getTileServerUrl } from "../map/lotContext"

// Capas vectoriales servidas por el backend FastAPI en AWS vía MVT (Mapbox Vector Tiles)
const MVT_LAYERS = [
  {
    id: "mvt.districts",
    name: "Límites Distritales",
    description: "Polígonos distritales de Lima y Callao",
    minZoom: 7,
    maxZoom: 22,
  },
  {
    id: "mvt.blocks",
    name: "Manzanas Catastrales",
    description: "Manzanas de catastro",
    minZoom: 12,
    maxZoom: 22,
  },
  {
    id: "mvt.lots",
    name: "Lotes Catastrales",
    description: "Lotes con geometría corregida e información predial",
    minZoom: 15,
    maxZoom: 22,
  },
  {
    id: "mvt.water_pipes",
    name: "Red de Tuberías",
    description: "Tuberías de distribución de agua potable",
    minZoom: 12,
    maxZoom: 22,
  },
  {
    id: "mvt.water_connections",
    name: "Acometidas de Agua",
    description: "Conexiones domiciliarias a la red",
    minZoom: 16,
    maxZoom: 22,
  },
  {
    id: "mvt.valves",
    name: "Válvulas",
    description: "Válvulas de control y sectorización",
    minZoom: 14,
    maxZoom: 22,
  },
  {
    id: "mvt.supplies",
    name: "Suministros",
    description: "Puntos de suministros activos",
    minZoom: 16,
    maxZoom: 22,
  },
]

// Datos de túnel SSH alternativo para técnicos
const PG_HOST_LOCAL = "127.0.0.1"
const PG_TUNNEL_PORT = "5433"
const PG_DATABASE = "bd_facturacion_local"
const PG_USER = "app_user"
const SSH_HOST = "35.168.24.153"
const SSH_PORT = "2222"
const SSH_USER = "ubuntu"
const SSH_KEY = "LightsailDefaultKey-us-east-1.pem"
const TUNNEL_CMD = `ssh -i "${SSH_KEY}" -p ${SSH_PORT} -N -L ${PG_TUNNEL_PORT}:${PG_HOST_LOCAL}:5432 ${SSH_USER}@${SSH_HOST}`

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={copied ? "Copiado" : label}
            className="shrink-0"
            onClick={handleCopy}
            size="icon-xs"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3 text-green-500" />
            ) : (
              <Copy aria-hidden="true" className="size-3" />
            )}
          </Button>
        }
      />
      <TooltipContent side="top">{copied ? "¡Copiado!" : label}</TooltipContent>
    </Tooltip>
  )
}

function SectionToggle({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t pt-3">
      <button
        className="flex w-full items-center justify-between text-left text-xs font-semibold text-foreground hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>{title}</span>
        {open ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open ? <div className="mt-2.5">{children}</div> : null}
    </div>
  )
}

export function QgisConnectionDialog(): React.JSX.Element {
  const [tileBaseUrl, setTileBaseUrl] = useState<string | null>(null)
  const [loadingTiles, setLoadingTiles] = useState(false)
  const [tileError, setTileError] = useState<string | null>(null)
  const [selectedHours, setSelectedHours] = useState(5)

  async function fetchTilesUrl(hours = selectedHours): Promise<void> {
    setLoadingTiles(true)
    setTileError(null)
    try {
      const url = await getTileServerUrl(hours)
      setTileBaseUrl(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTileError(msg || "No se pudo obtener el token de teselas.")
    } finally {
      setLoadingTiles(false)
    }
  }

  function handleOpenChange(open: boolean): void {
    if (open && !tileBaseUrl && !loadingTiles) {
      void fetchTilesUrl(selectedHours)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  aria-label="Conectar con QGIS"
                  className="text-muted-foreground hover:text-foreground"
                  size="icon"
                  variant="ghost"
                >
                  <Layers aria-hidden="true" size={16} strokeWidth={1.75} />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="bottom">Conectar con QGIS</TooltipContent>
      </Tooltip>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4 text-primary" />
            Conexión de Capas en QGIS
          </DialogTitle>
          <DialogDescription>
            Conecta QGIS directamente a las capas GIS de Sedapal alojadas en AWS.
          </DialogDescription>
        </DialogHeader>

        {/* MÉTODO RECOMENDADO: TESELAS VECTORIALES (MVT) */}
        <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  1
                </span>
                Método Recomendado: Teselas Vectoriales (MVT / XYZ)
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                <strong>Sin túnel SSH ni claves .pem:</strong> QGIS descarga las capas por HTTPS
                directamente desde el servidor web de Sedapal.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center rounded border bg-background text-[11px]">
                {[4, 5, 8].map((h) => (
                  <button
                    key={h}
                    className={`px-2 py-1 font-medium transition-colors ${
                      selectedHours === h
                        ? "bg-primary text-primary-foreground rounded-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setSelectedHours(h)
                      void fetchTilesUrl(h)
                    }}
                    type="button"
                  >
                    {h}h
                  </button>
                ))}
              </div>
              <Button
                className="h-7 shrink-0 text-xs"
                disabled={loadingTiles}
                onClick={() => void fetchTilesUrl(selectedHours)}
                size="sm"
                variant="outline"
              >
                {loadingTiles ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Renovar
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Token válido por {selectedHours} horas
            </span>
            <span className="text-[10px] text-muted-foreground">
              Listo para tu jornada de trabajo en QGIS
            </span>
          </div>

          {tileError ? (
            <p className="text-xs text-destructive">{tileError}</p>
          ) : null}

          {/* Instrucciones de QGIS */}
          <div className="rounded border bg-background/80 p-2.5 text-[11px] text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Cómo agregarlo en QGIS:</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>En QGIS, abre el panel <strong>Explorador (Browser)</strong>.</li>
              <li>Busca <strong>Teselas vectoriales (Vector Tiles)</strong> → clic derecho → <strong>Nueva conexión genérica...</strong></li>
              <li>Ingresa un nombre (ej. <em>Sedapal - Lotes</em>) y pega la <strong>URL de la capa</strong>.</li>
              <li>Configura el <strong>Zoom mín / máx</strong> indicado para cada capa y presiona Aceptar.</li>
            </ol>
          </div>

          {/* Tabla de capas MVT */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-foreground">URLs de Capas Disponibles:</span>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {MVT_LAYERS.map((layer) => {
                const layerUrl = tileBaseUrl
                  ? `${tileBaseUrl}/${layer.id}/{z}/{x}/{y}`
                  : `https://sedapalweb.com/fastapi/api/v1/gis/tiles/{TOKEN}/${layer.id}/{z}/{x}/{y}`

                return (
                  <div
                    key={layer.id}
                    className="flex flex-col gap-1 rounded border bg-card p-2 text-xs shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{layer.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        Zoom {layer.minZoom}–{layer.maxZoom}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{layer.description}</p>
                    <div className="flex items-center gap-1 mt-0.5 rounded bg-muted/60 px-2 py-1">
                      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                        {layerUrl}
                      </code>
                      <CopyButton value={layerUrl} label="Copiar URL para QGIS" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* MÉTODO ALTERNATIVO: POSTGRESQL DIRECTO CON TÚNEL SSH */}
        <SectionToggle title="Método Alternativo: Conexión directa a PostgreSQL (Vía Túnel SSH)">
          <p className="text-[11px] text-muted-foreground mb-2">
            Solo para administradores técnicos con acceso a la llave maestra{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
              {SSH_KEY}
            </code>
            . Requiere ejecutar el túnel SSH en PowerShell antes de abrir QGIS:
          </p>

          <div className="flex items-start gap-1.5 rounded-md border bg-muted/50 p-2 text-xs mb-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
              {TUNNEL_CMD}
            </code>
            <CopyButton value={TUNNEL_CMD} label="Copiar comando de túnel" />
          </div>

          <div className="rounded-md border p-2.5 text-xs space-y-1 bg-card">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-muted-foreground">Host:</span>{" "}
                <code className="font-mono text-foreground">{PG_HOST_LOCAL}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Puerto:</span>{" "}
                <code className="font-mono text-foreground">{PG_TUNNEL_PORT}</code>
              </div>
              <div>
                <span className="text-muted-foreground">BD:</span>{" "}
                <code className="font-mono text-foreground">{PG_DATABASE}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Usuario:</span>{" "}
                <code className="font-mono text-foreground">{PG_USER}</code>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              La contraseña de <code className="font-mono">app_user</code> se encuentra configurada en{" "}
              <code className="font-mono">D:\sedapal-backend-aws\.env</code>.
            </p>
          </div>
        </SectionToggle>
      </DialogContent>
    </Dialog>
  )
}
