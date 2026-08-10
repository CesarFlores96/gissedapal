import { Building2, Check, ChevronsUpDown, X } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import type { DistrictOption } from "../types"
import { Button } from "./ui/Button"
import { Input } from "./ui/input"
import { usePortalRect } from "./ui/usePortalRect"

type DistrictComboboxProps = {
  districts: DistrictOption[]
  onChange: (district: DistrictOption | null) => void
  selected: DistrictOption | null
}

/** Normaliza para buscar sin tildes ni mayúsculas ("BREÑA" encuentra "brena"). */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function matches(district: DistrictOption, query: string): boolean {
  if (!query) return true
  const needle = normalize(query)
  return normalize(district.name).includes(needle) || (district.code ?? "").includes(needle)
}

function districtLabel(district: DistrictOption): string {
  return district.code ? `${district.code} · ${district.name}` : district.name
}

/**
 * Selector de distrito buscable. Reemplaza al `<select>` nativo, que con 50
 * entradas obligaba a recorrer la lista a mano y no permitía filtrar por código.
 */
export function DistrictCombobox({ districts, onChange, selected }: DistrictComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()

  const results = useMemo(
    () => districts.filter((district) => matches(district, query)),
    [districts, query],
  )

  // Se acota en el punto de uso, no en un estado espejo sincronizado por
  // efecto: cuando el filtro reduce la lista, activeIndex puede quedar
  // apuntando fuera de rango hasta la próxima tecla, así que cada lectura se
  // ajusta contra el tamaño actual de `results`.
  const activeResultIndex = Math.min(activeIndex, Math.max(0, results.length - 1))
  const anchorRect = usePortalRect(open, containerRef)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      // La lista vive en un portal fuera de containerRef, así que un clic
      // dentro de ella también cuenta como "dentro" del combobox.
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" })
  }, [activeResultIndex, open])

  function commit(district: DistrictOption | null): void {
    onChange(district)
    setOpen(false)
    setQuery("")
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((current) => {
        if (!results.length) return 0
        return (current + step + results.length) % results.length
      })
      return
    }
    if (event.key === "Enter") {
      if (!open) return
      event.preventDefault()
      const district = results[activeResultIndex]
      if (district) commit(district)
      return
    }
    if (event.key === "Escape") {
      if (!open) return
      event.preventDefault()
      setOpen(false)
      setQuery("")
      return
    }
    if (event.key === "Home" && open) {
      event.preventDefault()
      setActiveIndex(0)
    }
    if (event.key === "End" && open) {
      event.preventDefault()
      setActiveIndex(Math.max(0, results.length - 1))
    }
  }

  const displayValue = open ? query : selected ? districtLabel(selected) : ""

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <Building2
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={16}
        strokeWidth={1.75}
      />
      <Input
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-label="Filtrar por distrito"
        autoComplete="off"
        className="h-9 pl-8 pr-16"
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          if (!open) setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Todos los distritos"
        ref={inputRef}
        role="combobox"
        value={displayValue}
      />

      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {selected ? (
          <Button
            aria-label="Quitar filtro de distrito"
            onClick={() => {
              commit(null)
              inputRef.current?.focus()
            }}
            size="icon-sm"
            title="Quitar filtro de distrito"
            variant="ghost"
          >
            <X aria-hidden="true" size={14} strokeWidth={2} />
          </Button>
        ) : null}
        <Button
          aria-label={open ? "Cerrar lista de distritos" : "Abrir lista de distritos"}
          onClick={() => {
            setOpen((value) => !value)
            inputRef.current?.focus()
          }}
          size="icon-sm"
          tabIndex={-1}
          variant="ghost"
        >
          <ChevronsUpDown aria-hidden="true" size={14} strokeWidth={1.75} />
        </Button>
      </div>

      {open && anchorRect ? createPortal(
        <ul
          className="fixed z-50 max-h-72 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          id={listId}
          ref={listRef}
          role="listbox"
          style={(() => {
            // Más ancho que el input: a su ancho real ("218 · JESÚS MARÍA")
            // los nombres largos como "CARMEN DE LA LEGUA REYNOSO" quedaban
            // truncados. Se acota contra el borde derecho del viewport.
            const width = Math.max(anchorRect.width, 340)
            const margin = 12
            const left = Math.min(anchorRect.left, Math.max(margin, window.innerWidth - width - margin))
            return { top: anchorRect.bottom + 6, left, width }
          })()}
        >
          <li>
            <Button
              className={`h-auto w-full justify-start px-2.5 py-2 text-left text-sm ${
                selected ? "text-muted-foreground" : "bg-muted text-foreground"
              }`}
              onClick={() => commit(null)}
              variant="ghost"
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {selected ? null : <Check aria-hidden="true" size={13} strokeWidth={2.5} />}
              </span>
              Todos los distritos
            </Button>
          </li>

          {results.length ? (
            results.map((district, index) => {
              const isSelected = selected?.name === district.name
              const isActive = index === activeResultIndex
              return (
                <li key={district.name}>
                  <Button
                    aria-selected={isSelected}
                    className={`h-auto w-full justify-start px-2.5 py-2 text-left text-sm ${
                      isActive ? "bg-muted" : ""
                    } ${isSelected ? "font-medium text-primary" : "text-foreground"}`}
                    data-active={isActive}
                    onClick={() => commit(district)}
                    onPointerMove={() => setActiveIndex(index)}
                    role="option"
                    variant="ghost"
                  >
                    <span className="grid size-4 shrink-0 place-items-center">
                      {isSelected ? <Check aria-hidden="true" size={13} strokeWidth={2.5} /> : null}
                    </span>
                    <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {district.code ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{district.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {district.supplyCount.toLocaleString("es-PE")}
                    </span>
                  </Button>
                </li>
              )
            })
          ) : (
            <li className="px-2.5 py-3 text-sm text-fg-subtle">Sin coincidencias para «{query}»</li>
          )}
        </ul>,
        document.body,
      ) : null}
    </div>
  )
}
