import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { getBuildingFacade, getBuildingFootprint, ipcErrorMessage } from "./ipc"

// Regresión real (2026-09-14): un `Result<T, AppError>` rechazado por Tauri
// llega como el objeto `{code, message}` ya deserializado, no como un string
// ni un `Error` de JS. `String(errorObject)` da "[object Object]" y nunca
// matchea nada, así que un 404 completamente normal (lote sin fachada/huella)
// se relanzaba como excepción en vez de resolver a `null` -- y como el LOD
// cargaba candidatos con `Promise.all`, un solo 404 tiraba abajo el lote
// entero, incluyendo los que sí tenían datos.
function tauriRejection(message: string): { code: string; message: string } {
  return { code: "api_error", message }
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe("ipcErrorMessage", () => {
  it("lee .message de un objeto de error deserializado por Tauri", () => {
    expect(ipcErrorMessage(tauriRejection("El lote no tiene fachada procedural generada."))).toBe(
      "el lote no tiene fachada procedural generada.",
    )
  })

  it("cae a String(error) para algo que no es un objeto con .message", () => {
    expect(ipcErrorMessage("plain string error")).toBe("plain string error")
    expect(ipcErrorMessage(null)).toBe("null")
  })
})

describe("getBuildingFacade", () => {
  it("devuelve null para el objeto de error real que manda Tauri en un 404", async () => {
    invokeMock.mockRejectedValueOnce(tauriRejection("El lote no tiene fachada procedural generada."))
    await expect(getBuildingFacade("lot-1")).resolves.toBeNull()
  })

  it("relanza un error que no es 'no encontrado'", async () => {
    invokeMock.mockRejectedValueOnce(tauriRejection("El servicio GIS respondió con estado 500."))
    await expect(getBuildingFacade("lot-1")).rejects.toBeTruthy()
  })
})

describe("getBuildingFootprint", () => {
  it("devuelve null para el objeto de error real que manda Tauri cuando no hay huella", async () => {
    invokeMock.mockRejectedValueOnce(tauriRejection("El lote no tiene huella digitalizada."))
    await expect(getBuildingFootprint("lot-1")).resolves.toBeNull()
  })
})
