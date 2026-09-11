import { describe, expect, it } from "vitest"

import { EMPTY_QUEUE_STATE, estimateRemainingMs, formatDuration, queueReducer } from "./queueState"
import type { MeterReport, QueueState, ScanResult } from "./types"

function scan(...names: string[]): ScanResult {
  return {
    folder: "C:/fotos",
    files: names.map((name) => ({
      fileName: name,
      filePath: `C:/fotos/${name}`,
      sizeBytes: 1024,
    })),
    skipped: [],
  }
}

function report(requiereRevision = false): MeterReport {
  return {
    numeroMedidor: "A-4471",
    lectura: "001234",
    estadoConexion: "Sin incidencia de conexión visible.",
    estadoMedidor: "Medidor en buen estado; lectura legible y sin incidencias visibles.",
    observacion: "Tapa con tierra.",
    requiereRevision,
  }
}

function started(names: string[], runToken = "run-1:1"): QueueState {
  const scanned = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: scan(...names) })
  return queueReducer(scanned, {
    type: "RUN_STARTED",
    event: {
      runId: "run-1",
      runToken,
      folder: "C:/fotos",
      total: names.length,
      concurrency: 1,
      promptVersion: 1,
    },
  })
}

describe("queueReducer", () => {
  it("ignora reintentos de otra ejecución aunque coincida el archivo", () => {
    const state = started(["a.jpg"])
    expect(queueReducer(state, { type: "FILE_DONE", event: { runToken: "retry:other", index: 0, fileName: "a.jpg", filePath: "C:/fotos/a.jpg", status: "done", report: report(), adjustments: [], durationMs: 20 } })).toBe(state)
  })

  it("al cancelar libera la foto en proceso y conserva los informes terminados", () => {
    let state = started(["a.jpg", "b.jpg"])
    state = queueReducer(state, { type: "FILE_DONE", event: { runToken: "run-1:1", index: 0, fileName: "a.jpg", filePath: "C:/fotos/a.jpg", status: "done", report: report(), adjustments: [], durationMs: 20 } })
    state = queueReducer(state, { type: "FILE_STARTED", event: { runToken: "run-1:1", index: 1, fileName: "b.jpg" } })
    state = queueReducer(state, { type: "RUN_FINISHED", event: { runToken: "run-1:1", runId: "run-1", status: "cancelled", processed: 1, ok: 1, review: 0, error: 0, cancelled: true } })
    expect(state.rows.map((row) => row.status)).toEqual(["done", "cancelled"])
    expect(state.counters).toMatchObject({ processed: 1, pending: 0, ok: 1 })
  })
  it("muestra la cantidad de imágenes encontradas antes de arrancar", () => {
    const state = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: scan("a.jpg", "b.jpg") })
    expect(state.total).toBe(2)
    expect(state.rows).toHaveLength(2)
    expect(state.counters.pending).toBe(2)
    expect(state.status).toBe("idle")
  })

  it("acumula progreso separando correctas, con revisión y con error", () => {
    let state = started(["a.jpg", "b.jpg", "c.jpg"])

    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 0,
        fileName: "a.jpg",
        filePath: "C:/fotos/a.jpg",
        status: "done",
        report: report(false),
        adjustments: [],
        durationMs: 1000,
      },
    })
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 1,
        fileName: "b.jpg",
        filePath: "C:/fotos/b.jpg",
        status: "done",
        report: report(true),
        adjustments: ["recomputed_review"],
        durationMs: 1200,
      },
    })
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 2,
        fileName: "c.jpg",
        filePath: "C:/fotos/c.jpg",
        status: "error",
        adjustments: [],
        errorMessage: "no se pudo leer la imagen",
        durationMs: 300,
      },
    })

    expect(state.counters).toEqual({ processed: 3, pending: 0, ok: 1, review: 1, error: 1 })
  })

  it("conserva el error visible y lo mantiene al reintentar", () => {
    let state = started(["a.jpg"])
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 0,
        fileName: "a.jpg",
        filePath: "C:/fotos/a.jpg",
        status: "error",
        adjustments: [],
        errorMessage: "timeout de Ollama",
        durationMs: 500,
      },
    })
    expect(state.rows[0]?.errorMessage).toBe("timeout de Ollama")

    // Al reintentar la fila vuelve a correr pero el error sigue a la vista.
    state = queueReducer(state, { type: "RETRY_STARTED", filePath: "C:/fotos/a.jpg" })
    expect(state.rows[0]?.status).toBe("running")
    expect(state.rows[0]?.errorMessage).toBe("timeout de Ollama")

    // Solo un resultado bueno lo reemplaza.
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "retry:run-1",
        index: 0,
        fileName: "a.jpg",
        filePath: "C:/fotos/a.jpg",
        status: "done",
        report: report(false),
        adjustments: [],
        durationMs: 900,
      },
    })
    expect(state.rows[0]?.errorMessage).toBeNull()
    expect(state.counters).toEqual({ processed: 1, pending: 0, ok: 1, review: 0, error: 0 })
  })

  it("ignora los eventos de una ejecución anterior", () => {
    const state = started(["a.jpg", "b.jpg"], "run-2:5")
    const contaminado = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 0,
        fileName: "a.jpg",
        filePath: "C:/fotos/a.jpg",
        status: "done",
        report: report(false),
        adjustments: [],
        durationMs: 1000,
      },
    })
    expect(contaminado).toBe(state)
    expect(contaminado.counters.processed).toBe(0)
  })

  it("cancelar conserva los resultados ya obtenidos", () => {
    let state = started(["a.jpg", "b.jpg", "c.jpg"])
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: {
        runToken: "run-1:1",
        index: 0,
        fileName: "a.jpg",
        filePath: "C:/fotos/a.jpg",
        status: "done",
        report: report(false),
        adjustments: [],
        durationMs: 1000,
      },
    })
    state = queueReducer(state, { type: "CANCEL_REQUESTED" })

    expect(state.status).toBe("cancelling")
    expect(state.rows[0]?.status).toBe("done")
    expect(state.rows[0]?.report).not.toBeNull()
    expect(state.rows[1]?.status).toBe("cancelled")
    expect(state.counters.ok).toBe(1)
  })

  it("no duplica un mensaje de fallo de persistencia repetido", () => {
    let state = started(["a.jpg"])
    const event = { runToken: "run-1:1", count: 10, message: "sin conexión" }
    state = queueReducer(state, { type: "PERSIST_FAILED", event })
    state = queueReducer(state, { type: "PERSIST_FAILED", event })
    expect(state.persistErrors).toHaveLength(1)
    expect(state.persistErrors[0]).toContain("sin conexión")
  })

  it("marca la ejecución como cancelada al terminar tras un cancel", () => {
    let state = started(["a.jpg"])
    state = queueReducer(state, {
      type: "RUN_FINISHED",
      event: {
        runToken: "run-1:1",
        runId: "run-1",
        status: "cancelled",
        processed: 0,
        ok: 0,
        review: 0,
        error: 0,
        cancelled: true,
      },
    })
    expect(state.status).toBe("cancelled")
  })

  it("recuenta desde las filas, así que un evento repetido no infla el total", () => {
    let state = started(["a.jpg", "b.jpg"])
    const event = {
      runToken: "run-1:1",
      index: 0,
      fileName: "a.jpg",
      filePath: "C:/fotos/a.jpg",
      status: "done" as const,
      report: report(false),
      adjustments: [],
      durationMs: 1000,
    }
    state = queueReducer(state, { type: "FILE_DONE", event })
    state = queueReducer(state, { type: "FILE_DONE", event })
    expect(state.counters.ok).toBe(1)
    expect(state.counters.processed).toBe(1)
  })
})

describe("descartar fotografías antes de analizar", () => {
  it("quita la fotografía de la cola y reindexa las que quedan", () => {
    let state = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: scan("a.jpg", "b.jpg", "c.jpg") })
    state = queueReducer(state, { type: "EXCLUDE_FILE", filePath: "C:/fotos/b.jpg" })
    expect(state.rows.map((row) => row.fileName)).toEqual(["a.jpg", "c.jpg"])
    // El índice debe seguir coincidiendo con la posición que usará Rust.
    expect(state.rows.map((row) => row.index)).toEqual([0, 1])
    expect(state.total).toBe(2)
    expect(state.counters.pending).toBe(2)
  })

  it("no descarta nada mientras la cola está corriendo", () => {
    const state = started(["a.jpg", "b.jpg"])
    expect(queueReducer(state, { type: "EXCLUDE_FILE", filePath: "C:/fotos/a.jpg" })).toBe(state)
  })

  it("no descarta una fotografía que ya tiene informe", () => {
    let state = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: scan("a.jpg") })
    state = queueReducer(state, {
      type: "RUN_STARTED",
      event: { runId: "run-1", runToken: "run-1:1", folder: "C:/fotos", total: 1, concurrency: 1, promptVersion: 1 },
    })
    state = queueReducer(state, {
      type: "FILE_DONE",
      event: { runToken: "run-1:1", index: 0, fileName: "a.jpg", filePath: "C:/fotos/a.jpg", status: "done", report: report(), adjustments: [], durationMs: 10 },
    })
    state = queueReducer(state, { type: "RUN_FINISHED", event: { runToken: "run-1:1", runId: "run-1", status: "completed", processed: 1, ok: 1, review: 0, error: 0, cancelled: false } })
    const intento = queueReducer(state, { type: "EXCLUDE_FILE", filePath: "C:/fotos/a.jpg" })
    expect(intento.rows).toHaveLength(1)
  })

  it("empezar de cero deja la vista vacía", () => {
    const state = started(["a.jpg", "b.jpg"])
    expect(queueReducer(state, { type: "RESET" })).toEqual(EMPTY_QUEUE_STATE)
  })
})

describe("estimateRemainingMs", () => {
  it("no estima con menos de tres muestras", () => {
    const state = started(["a.jpg", "b.jpg"])
    expect(estimateRemainingMs(state)).toBeNull()
  })

  it("usa la mediana para que un caso lento no distorsione la estimación", () => {
    let state = started(["a.jpg", "b.jpg", "c.jpg", "d.jpg"])
    const durations = [1000, 1000, 90_000]
    durations.forEach((durationMs, index) => {
      state = queueReducer(state, {
        type: "FILE_DONE",
        event: {
          runToken: "run-1:1",
          index,
          fileName: `f${index}.jpg`,
          filePath: `C:/fotos/f${index}.jpg`,
          status: "done",
          report: report(false),
          adjustments: [],
          durationMs,
        },
      })
    })
    // Mediana 1000 ms x 1 foto pendiente: el outlier de 90 s no manda.
    expect(estimateRemainingMs(state)).toBe(1000)
  })
})

describe("formatDuration", () => {
  it("usa la unidad adecuada a la escala", () => {
    expect(formatDuration(400)).toBe("400 ms")
    expect(formatDuration(4500)).toBe("5 s")
    expect(formatDuration(125_000)).toBe("2 min 05 s")
    expect(formatDuration(3_725_000)).toBe("1 h 02 min")
  })
})

describe("escala a lotes grandes", () => {
  // Una carpeta de 30 000 fotografías es el caso real que motivó esta prueba.
  // El reducer copia el arreglo de filas en cada evento, así que el costo es
  // O(n) por evento: lo que importa es que ese O(n) siga siendo barato y que
  // la memoria no explote. Los umbrales son holgados a propósito, para que la
  // prueba falle ante una regresión de orden de magnitud, no ante el ruido de
  // una máquina cargada.
  const TOTAL = 30_000

  function lote(total: number): ScanResult {
    return {
      folder: "C:/fotos",
      files: Array.from({ length: total }, (_, index) => ({
        fileName: `foto_${index}.jpg`,
        filePath: `C:/fotos/foto_${index}.jpg`,
        sizeBytes: 2_000_000,
      })),
      skipped: [],
    }
  }

  it("prepara 30 000 fotografías sin degradarse", () => {
    const inicio = performance.now()
    const state = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: lote(TOTAL) })
    expect(state.total).toBe(TOTAL)
    expect(state.counters.pending).toBe(TOTAL)
    expect(performance.now() - inicio).toBeLessThan(3000)
  })

  it("procesa eventos a un costo estable con la cola llena", () => {
    let state = queueReducer(EMPTY_QUEUE_STATE, { type: "SCANNED", scan: lote(TOTAL) })
    state = queueReducer(state, {
      type: "RUN_STARTED",
      event: { runId: "run-1", runToken: "run-1:1", folder: "C:/fotos", total: TOTAL, concurrency: 1, promptVersion: 1 },
    })

    // 200 resultados seguidos sobre la cola llena: si el costo por evento
    // dependiera del total de forma cuadrática, esto no terminaría.
    const inicio = performance.now()
    for (let index = 0; index < 200; index += 1) {
      state = queueReducer(state, {
        type: "FILE_DONE",
        event: {
          runToken: "run-1:1",
          index,
          fileName: `foto_${index}.jpg`,
          filePath: `C:/fotos/foto_${index}.jpg`,
          status: "done",
          report: report(false),
          adjustments: [],
          durationMs: 1200,
        },
      })
    }
    expect(performance.now() - inicio).toBeLessThan(5000)
    expect(state.counters).toMatchObject({ processed: 200, ok: 200, pending: TOTAL - 200 })
  })
})
