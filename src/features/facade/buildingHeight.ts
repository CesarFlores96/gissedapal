/**
 * Curva de altura compartida por las dos capas `fill-extrusion` de
 * MapView.tsx (`lot-building-extrusion` y `building-footprint-extrusion`):
 * antes vivía repetida en ambos `paint` (ver historial de MapView.tsx). No es
 * "pisos * altura de piso" literal -- es una curva de exageración visual para
 * que un lote de 0-1 pisos siga siendo visible en el mapa a baja altura sin
 * que un edificio de 20 pisos se dispare a una escala absurda.
 *
 * No confundir con `DEFAULT_FLOOR_HEIGHT_M`: esa es la altura real (metros)
 * que usa el backend para la fachada procedural 2.5D
 * (`facade_service.DEFAULT_FLOOR_HEIGHT_M` en sedapal-backend-aws), pensada
 * para una maqueta a escala real, no para esta curva de mapa.
 */
export const EXTRUSION_HEIGHT_STOPS = [0, 1.2, 1, 3, 5, 15, 20, 60] as const

/**
 * Arma la expresión `fill-extrusion-height` de MapLibre a partir de
 * cualquier expresión que resuelva a "cuantos pisos tiene este feature".
 * Mantiene exactamente el mismo comportamiento que las dos expresiones
 * duplicadas que reemplaza (mismos stops, mismo tipo de interpolación).
 *
 * Tipada como `any` a propósito: MapLibre exige que este tipo de expresión
 * sea literalmente una tupla (`["interpolate", ["linear"], ...]`) para que
 * el tipado estricto de `DataDrivenPropertyValueSpecification` la acepte, lo
 * que una función genérica que arma el array en runtime no puede producir a
 * nivel de tipos sin perder la ventaja de centralizar los stops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildExtrusionHeightExpression(levelsExpression: unknown): any {
  return ["interpolate", ["linear"], levelsExpression, ...EXTRUSION_HEIGHT_STOPS]
}

/** La misma curva evaluada en JS (MapLibre `interpolate` lineal, que satura
 * en los extremos): la fachada 2.5D se apoya delante de la caja del lote y
 * tiene que medir exactamente lo mismo que ella. */
export function extrusionHeightForLevels(levels: number): number {
  const stops = EXTRUSION_HEIGHT_STOPS
  if (levels <= stops[0]) return stops[1]
  for (let i = 2; i < stops.length; i += 2) {
    if (levels <= stops[i]) {
      const t = (levels - stops[i - 2]) / (stops[i] - stops[i - 2])
      return stops[i - 1] + t * (stops[i + 1] - stops[i - 1])
    }
  }
  return stops[stops.length - 1]
}

/**
 * Altura real de un piso, en metros, para la fachada procedural 2.5D. Debe
 * coincidir con `DEFAULT_FLOOR_HEIGHT_M` en
 * `sedapal-backend-aws/app/sedapalgis/facade_service.py` -- el backend ya
 * hace ese cálculo y lo manda en `facade.dimensions.heightM`, así que el
 * frontend normalmente no necesita recalcularlo; esta constante existe para
 * mostrarla en el overlay de debug y para que ambos números no diverjan si
 * alguno de los dos lados cambia sin avisar al otro.
 */
export const DEFAULT_FLOOR_HEIGHT_M = 2.8
