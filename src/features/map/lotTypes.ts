/**
 * Tipos de lote del catastro SEDAPAL que no son predios edificables: no se
 * extruyen en 3D ni pueden ser el objetivo de un análisis de Street View
 * (la cámara suele estar parada sobre la berma de la avenida). Misma lista
 * que `NON_BUILDING_LOT_TYPES` en `sedapal-backend-aws/app/sedapalgis/lot_types.py`.
 * TL010/TL013/TL014 no tienen significado conocido y se tratan como predios.
 */
export const NON_BUILDING_LOT_TYPES = [
  "TL002", // Berma
  "TL003", // Parque
  "TL004", // Óvalo
  "TL005", // Área verde
  "TL006", // Costa Verde
  "TL007", // Huaca
  "TL008", // Solar
  "TL009", // Zona agrícola
  "Área Verde",
] as const

const nonBuilding = new Set<string>(NON_BUILDING_LOT_TYPES)

export function isBuildingLotType(lotTypeCode: unknown): boolean {
  return !(typeof lotTypeCode === "string" && nonBuilding.has(lotTypeCode.trim()))
}
