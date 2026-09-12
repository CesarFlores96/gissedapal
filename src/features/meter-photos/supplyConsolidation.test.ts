import { describe, expect, it } from "vitest"
import { extractSupplyNis, evaluatePhoto, consolidateMeterResults } from "./supplyConsolidation"
import type { MeterResult } from "./types"

describe("extractSupplyNis", () => {
  it("extrae el NIS de estructuras con prefijo de orden y subíndice", () => {
    expect(extractSupplyNis("1001TE202502007-4_4261265_1.jpg")).toEqual({
      nis: "4261265",
      photoIndex: 1,
    })
    expect(extractSupplyNis("1001TE202502007-16_2652682_3.jpg")).toEqual({
      nis: "2652682",
      photoIndex: 3,
    })
  })

  it("extrae el NIS de estructuras simples", () => {
    expect(extractSupplyNis("2653638_1.jpg")).toEqual({
      nis: "2653638",
      photoIndex: 1,
    })
    expect(extractSupplyNis("3090811.jpg")).toEqual({
      nis: "3090811",
      photoIndex: null,
    })
  })
})

describe("evaluatePhoto y consolidateSupplyPhotos", () => {
  it("clasifica agua acumulada como Nivel 1 Crítico", () => {
    const res = evaluatePhoto("No visible", "No visible", "Caja con agua acumulada e inundación", "No visible", "Agua", "done")
    expect(res.criticality).toBe(1)
    expect(res.category).toBe("valida")
  })

  it("clasifica escombros abundantes como Nivel 2 Muy deficiente", () => {
    const res = evaluatePhoto("ZENNER-1", "0123", "Caja llena de escombros y basura", "Medidor visible", "Escombros", "done")
    expect(res.criticality).toBe(2)
    expect(res.category).toBe("valida")
  })

  it("clasifica barro o suciedad menor como Nivel 3 Deficiente / Observación", () => {
    const res = evaluatePhoto("DB23104649", "00754", "Sin incidencia de conexión visible.", "Medidor visible con barro", "Barro", "done")
    expect(res.criticality).toBe(3)
    expect(res.category).toBe("valida")
  })

  it("clasifica placa protectora oxidada como Nivel 2, no Nivel 3", () => {
    const res = evaluatePhoto(
      "No visible",
      "04321",
      "Sin incidencia de conexión visible.",
      "Medidor en buen estado; lectura legible y sin incidencias visibles.",
      "Se visualiza la placa protectora del medidor en estado oxidado.",
      "done"
    )
    expect(res.criticality).toBe(2)
    expect(res.category).toBe("valida")
    expect(res.incidencias.some((i) => i.includes("oxidado"))).toBe(true)
  })

  it("clasifica conexión mojada sin agua acumulada como Nivel 2, no Nivel 1", () => {
    const res = evaluatePhoto(
      "No visible",
      "03765",
      "Conexión Mojada Sin Agua Acumulada",
      "Medidor en buen estado; lectura legible y sin incidencias visibles.",
      "Medidor sobre superficie húmeda, sin agua estancada visible.",
      "done"
    )
    expect(res.criticality).toBe(2)
    expect(res.category).toBe("valida")
    expect(res.incidencias.some((i) => i.includes("húmeda"))).toBe(true)
  })

  it("consolida múltiples fotos dando prioridad al Nivel 1 si una foto está inundada", () => {
    const rows: MeterResult[] = [
      {
        id: "1",
        run_id: "r1",
        file_name: "2653638_1.jpg",
        file_path: "/path/2653638_1.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "No visible",
        estado_conexion: "Caja de conexión con agua acumulada e inundación",
        estado_medidor: "No visible por sumersión",
        observacion: "Agua",
        requiere_revision: true,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
      {
        id: "2",
        run_id: "r1",
        file_name: "2653638_2.jpg",
        file_path: "/path/2653638_2.jpg",
        status: "done",
        numero_medidor: "DB12345",
        lectura: "00120",
        estado_conexion: "Sin incidencia visible",
        estado_medidor: "Medidor visible",
        observacion: "Polvo",
        requiere_revision: false,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
    ]

    const consolidated = consolidateMeterResults(rows)
    expect(consolidated).toHaveLength(1)
    const item = consolidated[0]
    expect(item.suministro).toBe("2653638")
    expect(item.nivelCriticidad).toBe(1)
    expect(item.descripcionNivel).toBe("Crítico")
    expect(item.accionSugerida).toBe("Atención inmediata")
    expect(item.numeroMedidor).toBe("DB12345")
    expect(item.lectura).toBe("00120")
    expect(item.totalFotos).toBe(2)
    expect(item.fotosValidas).toBe(2)
  })

  it("no confirma medidor no encontrado si otra toma lo muestra con lectura", () => {
    const rows: MeterResult[] = [
      {
        id: "1",
        run_id: "r1",
        file_name: "1001TE202502007-30_2030187_1.jpg",
        file_path: "/path/2030187_1.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "No visible",
        estado_conexion: "Caja Averiada Sin Lectura",
        estado_medidor: "Medidor No Encontrado",
        observacion: "Se observa un tubo de PVC en el lugar del medidor.",
        requiere_revision: true,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
      {
        id: "2",
        run_id: "r1",
        file_name: "1001TE202502007-30_2030187_2.jpg",
        file_path: "/path/2030187_2.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "36954",
        estado_conexion: "Caja Averiada Con Lectura",
        estado_medidor: "Medidor Manipulado-Averiado-Roto",
        observacion: "Medidor fuera de su posición original.",
        requiere_revision: false,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
    ]

    const consolidated = consolidateMeterResults(rows)
    expect(consolidated).toHaveLength(1)
    const item = consolidated[0]
    expect(item.nivelCriticidad).toBe(1)
    expect(item.medidorEncontrado).toBe("Sí")
    expect(item.lectura).toBe("36954")
    expect(item.conclusionConsolidada).not.toContain("no encontrado")
    expect(item.incidenciasDetectadas.some((i) => i.includes("no encontrado"))).toBe(false)
    expect(item.estadoMedidor).toBe("Medidor Manipulado-Averiado-Roto")
  })

  it("atribuye daño severo a la conexión, no al medidor, cuando el medidor está bien", () => {
    const rows: MeterResult[] = [
      {
        id: "1",
        run_id: "r1",
        file_name: "1001TE202502015-21_2614674_1.jpg",
        file_path: "/path/2614674_1.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "17070",
        estado_conexion: "Caja de conexión rota y con fuga evidente",
        estado_medidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.",
        observacion: "Se observa fuga de agua en la conexión.",
        requiere_revision: true,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
    ]

    const consolidated = consolidateMeterResults(rows)
    expect(consolidated).toHaveLength(1)
    const item = consolidated[0]
    expect(item.nivelCriticidad).toBe(1)
    // La conclusión ahora cita la observación real de la IA para este
    // suministro, no una frase fija repetida en todos los casos de Nivel 1.
    expect(item.conclusionConsolidada).toBe("Se observa fuga de agua en la conexión.")
    expect(item.estadoMedidor).toBe("Medidor en buen estado; lectura legible y sin incidencias visibles.")
  })

  it("la conclusión cae al texto fijo si la IA no escribió observación", () => {
    const rows: MeterResult[] = [
      {
        id: "1",
        run_id: "r1",
        file_name: "2614674_1.jpg",
        file_path: "/path/2614674_1.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "17070",
        estado_conexion: "Caja de conexión rota y con fuga evidente",
        estado_medidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.",
        observacion: "No visible",
        requiere_revision: true,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
    ]

    const consolidated = consolidateMeterResults(rows)
    const item = consolidated[0]
    expect(item.nivelCriticidad).toBe(1)
    expect(item.conclusionConsolidada).toContain("daño severo en la conexión")
  })

  it("no repite la misma conclusión fija entre suministros inundados distintos", () => {
    const rowFor = (nis: string, observacion: string): MeterResult => ({
      id: nis,
      run_id: "r1",
      file_name: `${nis}_1.jpg`,
      file_path: `/path/${nis}_1.jpg`,
      status: "done",
      numero_medidor: "No visible",
      lectura: "No visible",
      estado_conexion: "Caja de Conexión Inundada",
      estado_medidor: "No visible por sumersión",
      observacion,
      requiere_revision: true,
      post_process_applied: [],
      error_message: null,
      analyzed_at: null,
    })

    const [r1] = consolidateMeterResults([rowFor("1111111", "Se observa la caja completamente cubierta por agua estancada de lluvia.")])
    const [r2] = consolidateMeterResults([rowFor("2222222", "La caja presenta agua acumulada proveniente de una fuga de la matriz cercana.")])

    expect(r1.nivelCriticidad).toBe(1)
    expect(r2.nivelCriticidad).toBe(1)
    expect(r1.conclusionConsolidada).not.toBe(r2.conclusionConsolidada)
    expect(r1.conclusionConsolidada).toContain("lluvia")
    expect(r2.conclusionConsolidada).toContain("matriz")
  })

  it("medidor no encontrado por mal ángulo o toma insuficiente no es crítico", () => {
    const res = evaluatePhoto(
      "No visible",
      "No visible",
      "Sin incidencia de conexión visible.",
      "Medidor No Encontrado",
      "Se observa una tapa metálica con el código NIS escrito en ella; no se visualiza el medidor.",
      "done"
    )
    expect(res.category).toBe("noConcluyente")
    expect(res.criticality).toBe(4)
    expect(res.incidencias.some((i) => i.includes("no hay evidencia física"))).toBe(true)
  })

  it("medidor no encontrado sin mencionar ángulo o tapa tampoco es crítico (redacción real de producción)", () => {
    const res = evaluatePhoto(
      "No visible",
      "No visible",
      "Sin incidencia de conexión visible.",
      "Medidor No Encontrado",
      "La fotografía muestra una tapa metálica con la anotación 'NIS-2774016' escrita a mano; no se observa el medidor ni el visor.",
      "done"
    )
    expect(res.category).toBe("noConcluyente")
    expect(res.criticality).toBe(4)
  })

  it("medidor no encontrado con evidencia física real sigue siendo crítico", () => {
    const res = evaluatePhoto(
      "No visible",
      "No visible",
      "Caja Averiada Sin Lectura",
      "Medidor No Encontrado",
      "Se observa un tubo de PVC en el lugar del medidor.",
      "done"
    )
    expect(res.category).toBe("valida")
    expect(res.criticality).toBe(1)
    expect(res.incidencias.some((i) => i.includes("no encontrado"))).toBe(true)
  })

  it("reflejo tipo espejo en el visor no se confunde con inundación", () => {
    const res = evaluatePhoto(
      "KB20001732",
      "No visible",
      "Caja de Conexión Inundada",
      "Medidor Con Lectura Imposible",
      "El visor del medidor presenta un reflejo nítido tipo espejo que impide la lectura y se observa agua acumulada.",
      "done"
    )
    expect(res.criticality).not.toBe(1)
    expect(res.category).toBe("valida")
    expect(res.incidencias.some((i) => i.includes("inundada"))).toBe(false)
  })

  it("reflejo no suprime una inundación con evidencia fuerte (sumergido)", () => {
    const res = evaluatePhoto(
      "No visible",
      "No visible",
      "Caja de conexión encharcada con agua acumulada",
      "Medidor Con Lectura Imposible",
      "El visor presenta un reflejo tipo espejo y la caja está sumergida en agua.",
      "done"
    )
    expect(res.criticality).toBe(1)
  })

  it("conexión mojada sin agua acumulada no dispara inundación (Nivel 1) en el consolidado", () => {
    const rows: MeterResult[] = [
      {
        id: "1",
        run_id: "r1",
        file_name: "2529771_2.jpg",
        file_path: "/path/2529771_2.jpg",
        status: "done",
        numero_medidor: "No visible",
        lectura: "03765",
        estado_conexion: "Conexión Mojada Sin Agua Acumulada",
        estado_medidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.",
        observacion: "Medidor sobre superficie húmeda, sin agua estancada visible.",
        requiere_revision: false,
        post_process_applied: [],
        error_message: null,
        analyzed_at: null,
      },
    ]

    const consolidated = consolidateMeterResults(rows)
    expect(consolidated).toHaveLength(1)
    const item = consolidated[0]
    expect(item.nivelCriticidad).toBe(2)
    expect(item.conclusionConsolidada).not.toContain("inundada")
  })
})
