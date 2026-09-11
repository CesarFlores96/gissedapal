import { describe, expect, it } from "vitest"
import { isReadOnlyUser } from "./sessionContext"
import type { SessionUser } from "../../types"

describe("isReadOnlyUser", () => {
  it("detecta al usuario myfsedapal por username", () => {
    const user1: SessionUser = { id: "1", email: null, username: "myfsedapal" }
    const user2: SessionUser = { id: "2", email: "otro@sedapal.com.pe", username: "MYFSEDAPAL" }
    const user3: SessionUser = { id: "3", email: null, username: "  myfsedapal  " }

    expect(isReadOnlyUser(user1)).toBe(true)
    expect(isReadOnlyUser(user2)).toBe(true)
    expect(isReadOnlyUser(user3)).toBe(true)
  })

  it("detecta al usuario myfsedapal por email", () => {
    const user1: SessionUser = { id: "1", email: "myfsedapal@sedapal.com.pe" }
    const user2: SessionUser = { id: "2", email: "MYFSEDAPAL@SEDAPAL.COM.PE" }
    const user3: SessionUser = { id: "3", email: "myfsedapal" }

    expect(isReadOnlyUser(user1)).toBe(true)
    expect(isReadOnlyUser(user2)).toBe(true)
    expect(isReadOnlyUser(user3)).toBe(true)
  })

  it("detecta cuando isReadOnly viene precalculado desde Rust/backend", () => {
    const user: SessionUser = { id: "1", email: "cualquiera@sedapal.com.pe", isReadOnly: true }
    expect(isReadOnlyUser(user)).toBe(true)
  })

  it("detecta roles de solo consulta", () => {
    expect(isReadOnlyUser({ id: "1", email: null, role: "read_only" })).toBe(true)
    expect(isReadOnlyUser({ id: "2", email: null, role: "readonly" })).toBe(true)
    expect(isReadOnlyUser({ id: "3", email: null, role: "consulta" })).toBe(true)
    expect(isReadOnlyUser({ id: "4", email: null, role: "visualizador" })).toBe(true)
  })

  it("devuelve false para usuarios normales o sin sesión", () => {
    expect(isReadOnlyUser(null)).toBe(false)
    expect(isReadOnlyUser(undefined)).toBe(false)
    expect(isReadOnlyUser({ id: "1", email: "admin@sedapal.com.pe", username: "admin", role: "admin" })).toBe(false)
    expect(isReadOnlyUser({ id: "2", email: "operador@sedapal.com.pe", username: "operador" })).toBe(false)
  })
})
