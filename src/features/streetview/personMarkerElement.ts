// Ícono "person-standing" de lucide-react (ISC), inlineado a mano: no hay
// precedente en el proyecto de montar un ícono React dentro de un
// `maplibregl.Marker`, así que el SVG se arma directo con el mismo path data.
const PERSON_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="5" r="1"></circle>
    <path d="m9 20 3-6 3 6"></path>
    <path d="m6 8 6 2 6-2"></path>
    <path d="M12 10v4"></path>
  </svg>
`

export type PersonMarkerElement = {
  root: HTMLDivElement
  setHeading: (heading: number | null) => void
}

/**
 * Marcador de "dónde estoy parado" para Street View: un cono que apunta hacia
 * el heading actual (oculto si no hay heading todavía) detrás de una insignia
 * circular con el ícono de persona.
 */
export function createPersonMarkerElement(): PersonMarkerElement {
  const root = document.createElement("div")
  root.style.position = "relative"
  root.style.width = "34px"
  root.style.height = "34px"

  const cone = document.createElement("div")
  cone.style.position = "absolute"
  cone.style.inset = "-12px"
  cone.style.transformOrigin = "50% 50%"
  cone.style.transition = "transform 0.2s ease"
  cone.style.display = "none"
  cone.innerHTML = `
    <svg viewBox="0 0 58 58" width="58" height="58">
      <polygon points="29,0 20,22 38,22" fill="rgba(37,99,235,0.55)"></polygon>
    </svg>
  `
  root.appendChild(cone)

  const badge = document.createElement("div")
  badge.style.position = "absolute"
  badge.style.inset = "0"
  badge.style.display = "flex"
  badge.style.alignItems = "center"
  badge.style.justifyContent = "center"
  badge.style.borderRadius = "9999px"
  badge.style.background = "#2563eb"
  badge.style.border = "2px solid #ffffff"
  badge.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)"
  badge.innerHTML = PERSON_ICON_SVG
  root.appendChild(badge)

  const setHeading = (heading: number | null): void => {
    if (heading === null) {
      cone.style.display = "none"
      return
    }
    cone.style.display = "block"
    cone.style.transform = `rotate(${heading}deg)`
  }

  return { root, setHeading }
}
