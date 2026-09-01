import type { SupervisionEvidenceItem } from "../types"

/**
 * Agrupación de la evidencia archivada de un suministro.
 *
 * El backend guarda cada archivo bajo `{Mes}_{Año}/{dd}_{mm}_{aaaa}/`, así que
 * agrupar por carpeta o por día es recorrer esas mismas claves: no hay que
 * volver a parsear fechas ni adivinar zonas horarias en el cliente.
 */
export type EvidenceGroupMode = "day" | "folder"

export const EVIDENCE_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export const EVIDENCE_UNDATED_KEY = "Sin_fecha"

export interface EvidenceGroup {
  key: string
  label: string
  items: SupervisionEvidenceItem[]
  photos: number
  videos: number
  supervisors: string[]
  workOrders: string[]
}

/** `Agosto_2026` -> `Agosto 2026`; `04_08_2026` -> `04/08/2026`. */
export function evidenceGroupLabel(key: string, mode: EvidenceGroupMode): string {
  if (key === EVIDENCE_UNDATED_KEY) return "Sin fecha de archivo"
  if (mode === "folder") return key.replace("_", " ")
  const [day, month, year] = key.split("_")
  return day && month && year ? `${day}/${month}/${year}` : key
}

/** Clave ordenable ISO-like, para no reconstruir una fecha real sólo por ordenar. */
export function evidenceGroupSortKey(key: string, mode: EvidenceGroupMode): string {
  if (key === EVIDENCE_UNDATED_KEY) return ""
  if (mode === "folder") {
    const [month, year] = key.split("_")
    const index = EVIDENCE_MONTHS.indexOf(month)
    return `${year}-${String(index >= 0 ? index + 1 : 0).padStart(2, "0")}`
  }
  const [day, month, year] = key.split("_")
  return `${year}-${month}-${day}`
}

export function formatEvidenceCapturedAt(value: string | null): string {
  if (!value) return "Sin fecha de captura"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })
}

/** Agrupa preservando el orden de llegada (el backend ya devuelve lo más reciente primero). */
export function buildEvidenceGroups(
  items: SupervisionEvidenceItem[],
  mode: EvidenceGroupMode,
): EvidenceGroup[] {
  const buckets = new Map<string, SupervisionEvidenceItem[]>()
  for (const item of items) {
    const key = mode === "folder" ? item.folder : item.day
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.entries()]
    .map(([key, groupItems]) => ({
      key,
      label: evidenceGroupLabel(key, mode),
      items: groupItems,
      photos: groupItems.filter((item) => item.mediaType === "photo").length,
      videos: groupItems.filter((item) => item.mediaType === "video").length,
      supervisors: [...new Set(groupItems.map((item) => item.supervisor).filter((value): value is string => Boolean(value)))],
      workOrders: [...new Set(groupItems.map((item) => item.workOrderNumber))],
    }))
    .sort((a, b) => evidenceGroupSortKey(b.key, mode).localeCompare(evidenceGroupSortKey(a.key, mode)))
}
