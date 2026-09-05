import { Box, LandPlot, LoaderCircle, MapPin, Search } from "lucide-react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DistrictCombobox } from "../../components/DistrictCombobox"
import { Badge, Button, Field } from "../../components/ui"
import { Separator } from "../../components/ui/separator"
import { usePortalRect } from "../../components/ui/usePortalRect"
import type { CadastreSearchResult, PlaceSuggestion } from "../../types"
import { useSelection } from "../selection/selectionContext"
import { useMapData } from "./mapDataContext"

const PLACE_SEARCH_DEBOUNCE_MS = 300

/**
 * Controles contextuales del mapa. Sustituyen a los grupos del antiguo ribbon:
 * ahora viven en la fila de cabecera del shell y solo existen en la ruta /mapa,
 * en vez de estar siempre presentes bajo una pestaña.
 */
export function MapToolbar(): React.JSX.Element {
  const { districtOptions, getViewContext, searching, selectDistrict, selectedDistrict, threeDimensional, toggleThreeDimensional } = useMapData()
  const { clearSelection, searchCadastre, searchPlaces, searchSupply, selectCadastreResult, selectPlace } = useSelection()

  const [supplyCode, setSupplyCode] = useState("")
  const [cadastreQuery, setCadastreQuery] = useState("")
  const [cadastreResults, setCadastreResults] = useState<CadastreSearchResult[]>([])
  const [cadastreSearching, setCadastreSearching] = useState(false)
  const cadastreWrapperRef = useRef<HTMLDivElement | null>(null)
  const cadastreResultsOpen = cadastreResults.length > 0
  const cadastreAnchorRect = usePortalRect(cadastreResultsOpen, cadastreWrapperRef)

  const [placeQuery, setPlaceQuery] = useState("")
  const [placeResults, setPlaceResults] = useState<PlaceSuggestion[]>([])
  const [placeSearching, setPlaceSearching] = useState(false)
  const [placeSearched, setPlaceSearched] = useState(false)
  const placeWrapperRef = useRef<HTMLDivElement | null>(null)
  const placeResultsOpen = placeResults.length > 0
  // Distingue "todavía no se buscó / se acaba de elegir algo" de "se buscó y
  // no hubo resultados", para poder mostrar un mensaje en vez de no mostrar nada.
  const placeNoResults = placeSearched && !placeSearching && !placeResultsOpen
  const placeDropdownOpen = placeResultsOpen || placeNoResults
  const placeAnchorRect = usePortalRect(placeDropdownOpen, placeWrapperRef)
  const placeRequestIdRef = useRef(0)
  const placeDebounceRef = useRef<number | null>(null)

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

  // Autocompletado tipo Google Maps: busca sola, sin esperar Enter, con
  // debounce para no disparar una petición por cada tecla. `placeRequestIdRef`
  // descarta respuestas fuera de orden si una búsqueda anterior tarda más que
  // la siguiente.
  function handlePlaceQueryChange(value: string): void {
    setPlaceQuery(value)
    setPlaceSearched(false)
    if (placeDebounceRef.current !== null) window.clearTimeout(placeDebounceRef.current)

    const normalized = value.trim()
    if (normalized.length < 2) {
      setPlaceResults([])
      setPlaceSearching(false)
      return
    }
    setPlaceSearching(true)
    const requestId = ++placeRequestIdRef.current
    placeDebounceRef.current = window.setTimeout(() => {
      const view = getViewContext()
      const near = view ? { lat: (view.bbox[1] + view.bbox[3]) / 2, lng: (view.bbox[0] + view.bbox[2]) / 2 } : undefined
      void searchPlaces(normalized, near).then((results) => {
        if (placeRequestIdRef.current !== requestId) return
        setPlaceResults(results)
        setPlaceSearching(false)
        setPlaceSearched(true)
      })
    }, PLACE_SEARCH_DEBOUNCE_MS)
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

      <div className="shrink-0" ref={placeWrapperRef}>
        <Field
          autoComplete="off"
          icon={
            placeSearching
              ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} strokeWidth={1.75} />
              : <MapPin aria-hidden="true" size={15} strokeWidth={1.75} />
          }
          label="Buscar un lugar en el mapa"
          onChange={(event) => handlePlaceQueryChange(event.target.value)}
          placeholder="Buscar un lugar…"
          title="Buscar un lugar en el mapa, como en Google Maps"
          value={placeQuery}
          wrapperClassName="w-56"
        />

        {placeDropdownOpen && placeAnchorRect ? createPortal(
          <ul
            className="fixed z-50 max-h-56 w-80 space-y-0.5 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ top: placeAnchorRect.bottom + 6, left: placeAnchorRect.left }}
          >
            {placeResultsOpen ? placeResults.map((result, index) => (
              <li key={`${result.placeId ?? "text"}:${index}`}>
                <Button
                  className="h-auto w-full justify-start px-2.5 py-2 text-left"
                  onClick={() => {
                    const view = getViewContext()
                    const near = view ? { lat: (view.bbox[1] + view.bbox[3]) / 2, lng: (view.bbox[0] + view.bbox[2]) / 2 } : undefined
                    void selectPlace(result, near)
                    setPlaceQuery(result.label)
                    setPlaceResults([])
                    setPlaceSearched(false)
                  }}
                  variant="ghost"
                >
                  <MapPin aria-hidden="true" className="shrink-0 text-muted-foreground" size={14} strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-sm">{result.label}</span>
                </Button>
              </li>
            )) : (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">
                Sin resultados para "{placeQuery.trim()}"
              </li>
            )}
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
