import { Box, LandPlot, LoaderCircle, Search } from "lucide-react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DistrictCombobox } from "../../components/DistrictCombobox"
import { Badge, Button, Field } from "../../components/ui"
import { Separator } from "../../components/ui/separator"
import { usePortalRect } from "../../components/ui/usePortalRect"
import type { CadastreSearchResult } from "../../types"
import { useSelection } from "../selection/selectionContext"
import { useMapData } from "./mapDataContext"

/**
 * Controles contextuales del mapa. Sustituyen a los grupos del antiguo ribbon:
 * ahora viven en la fila de cabecera del shell y solo existen en la ruta /mapa,
 * en vez de estar siempre presentes bajo una pestaña.
 */
export function MapToolbar(): React.JSX.Element {
  const { districtOptions, searching, selectDistrict, selectedDistrict, threeDimensional, toggleThreeDimensional } = useMapData()
  const { clearSelection, searchCadastre, searchSupply, selectCadastreResult } = useSelection()

  const [supplyCode, setSupplyCode] = useState("")
  const [cadastreQuery, setCadastreQuery] = useState("")
  const [cadastreResults, setCadastreResults] = useState<CadastreSearchResult[]>([])
  const [cadastreSearching, setCadastreSearching] = useState(false)
  const cadastreWrapperRef = useRef<HTMLDivElement | null>(null)
  const cadastreResultsOpen = cadastreResults.length > 0
  const cadastreAnchorRect = usePortalRect(cadastreResultsOpen, cadastreWrapperRef)

  async function submitCadastreSearch(): Promise<void> {
    const normalized = cadastreQuery.trim()
    if (normalized.length < 2) return
    setCadastreSearching(true)
    try {
      setCadastreResults(await searchCadastre(normalized))
    } finally {
      setCadastreSearching(false)
    }
  }

  return (
    <>
      <h1 className="sr-only" id="route-title" tabIndex={-1}>Mapa</h1>

      <form
        className="flex shrink-0 items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          const normalized = supplyCode.trim()
          if (normalized) void searchSupply(normalized)
        }}
      >
        <Field
          autoComplete="off"
          icon={<Search aria-hidden="true" size={15} strokeWidth={1.75} />}
          inputMode="numeric"
          label="Buscar por código de suministro o NIS"
          onChange={(event) => setSupplyCode(event.target.value)}
          placeholder="Suministro o NIS"
          title="Buscar por código de suministro o NIS"
          value={supplyCode}
          wrapperClassName="w-40"
        />
        <Button disabled={searching || !supplyCode.trim()} size="lg" type="submit" variant="primary">
          {searching ? "Buscando…" : "Buscar"}
        </Button>
      </form>

      <div className="shrink-0" ref={cadastreWrapperRef}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submitCadastreSearch()
          }}
        >
          <Field
            autoComplete="off"
            icon={
              cadastreSearching
                ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} strokeWidth={1.75} />
                : <LandPlot aria-hidden="true" size={15} strokeWidth={1.75} />
            }
            label="Buscar por lote o manzana"
            onChange={(event) => {
              setCadastreQuery(event.target.value)
              setCadastreResults([])
            }}
            placeholder="Lote o manzana"
            title="Buscar por lote o manzana. Presiona Enter para buscar."
            value={cadastreQuery}
            wrapperClassName="w-48"
          />
        </form>

        {cadastreResultsOpen && cadastreAnchorRect ? createPortal(
          <ul
            className="fixed z-50 max-h-56 w-72 space-y-0.5 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ top: cadastreAnchorRect.bottom + 6, left: cadastreAnchorRect.left }}
          >
            {cadastreResults.map((result) => {
              const blockCode = typeof result.properties.block_code === "string" ? result.properties.block_code : null
              return (
                <li key={`${result.kind}:${result.id}`}>
                  <Button
                    className="h-auto w-full justify-start px-2.5 py-2 text-left"
                    onClick={() => {
                      selectCadastreResult(result)
                      setCadastreQuery(result.code)
                      setCadastreResults([])
                    }}
                    variant="ghost"
                  >
                    <Badge tone={result.kind === "lot" ? "lot" : "block"}>
                      {result.kind === "lot" ? "Lote" : "Manzana"}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{result.code}</span>
                    {result.kind === "lot" && blockCode ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Mz {blockCode}</span>
                    ) : null}
                  </Button>
                </li>
              )
            })}
          </ul>,
          document.body,
        ) : null}
      </div>

      <Separator className="mx-0.5 h-6! self-center pointer-events-none" orientation="vertical" />

      <div className="w-48 shrink-0">
        <DistrictCombobox
          districts={districtOptions}
          onChange={(district) => {
            selectDistrict(district)
            clearSelection()
          }}
          selected={selectedDistrict}
        />
      </div>

      <Separator className="mx-0.5 h-6! self-center pointer-events-none" orientation="vertical" />
      <Button
        aria-pressed={threeDimensional}
        onClick={toggleThreeDimensional}
        size="lg"
        title="Altura temática proporcional a suministros por distrito"
        variant={threeDimensional ? "accent" : "outline"}
      >
        <Box aria-hidden="true" size={15} strokeWidth={1.75} />
        3D
      </Button>
    </>
  )
}
