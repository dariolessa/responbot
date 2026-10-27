import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as schema from "@/lib/db/schema"
import { forBusiness } from "@/lib/db/scoped"
import {
  businessDetail,
  conversationThread,
  extendTrial,
  recentConversations,
  recentProblems,
  searchBusinesses,
} from "@/lib/support/detail"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon } from "../helpers/bot"

/*
 * Soporte desde /admin: búsqueda de negocios, ficha, problemas recientes,
 * conversaciones con la traza del bot y extender la prueba (auditada).
 */

const DAY = 86_400_000

let db: TestDb
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

describe("soporte", () => {
  it("busca por nombre, email del equipo, número de WhatsApp e id", async () => {
    const salon = await seedSalon(db, "sop-busca")
    await salon.scoped.updateBusiness({ name: "Barbería Los Pinos" })
    await salon.scoped.whatsappAccounts.insert({
      wabaId: "w1",
      phoneNumberId: "sop-pn-1",
      displayPhone: "+598 99 123 456",
      accessTokenEnc: "x",
    })
    const now = new Date()

    const byName = await searchBusinesses(db, "los pinos", now)
    expect(byName.map((r) => r.id)).toEqual([salon.business.id])
    const byEmail = await searchBusinesses(db, "SOP-BUSCA@example", now)
    expect(byEmail.map((r) => r.id)).toEqual([salon.business.id])
    expect(byEmail[0]!.ownerEmail).toBe("sop-busca@example.com")
    const byPhone = await searchBusinesses(db, "099123456".slice(1), now)
    expect(byPhone.map((r) => r.id)).toContain(salon.business.id)
    const byId = await searchBusinesses(db, salon.business.id, now)
    expect(byId.map((r) => r.id)).toEqual([salon.business.id])
    expect(await searchBusinesses(db, "%", now)).toHaveLength(0)
    expect(await searchBusinesses(db, "no-existe-nada", now)).toHaveLength(0)
  })

  it("arma la ficha sin tokens, con problemas y conversaciones", async () => {
    const salon = await seedSalon(db, "sop-ficha")
    const scoped = salon.scoped
    const now = new Date()
    const [customer] = await scoped.customers.insert({ phoneE164: "+59899555001", name: "Lucía" })
    const [conversation] = await scoped.conversations.insert({
      customerId: customer!.id,
      lastInboundAt: now,
      lastMessageAt: now,
      lastMessagePreview: "Hola",
    })
    await scoped.messages.insert({ conversationId: conversation!.id, direction: "inbound", body: "Hola", status: "received" })
    await scoped.messages.insert({
      conversationId: conversation!.id,
      direction: "outbound",
      body: "Perdón, tuve un problema.",
      status: "sent",
      toolTrace: {
        model: "x",
        rounds: 1,
        tools: [{ name: "check_availability", input: {}, ok: false, output: null }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        error: "overloaded_error",
      },
    })
    await scoped.messages.insert({
      conversationId: conversation!.id,
      direction: "outbound",
      body: "Te escribo yo",
      status: "failed",
      sentBy: salon.owner.id,
      error: "131047: fuera de la ventana de 24 h",
    })
    await scoped.scheduledMessages.insert({
      customerId: customer!.id,
      kind: "reminder_24h",
      sendAt: now,
      status: "failed",
      lastError: "Sin WhatsApp conectado",
    })

    const detail = await businessDetail(db, salon.business.id, now)
    expect(detail).not.toBeNull()
    expect(detail!.members.map((m) => m.email)).toEqual(["sop-ficha@example.com"])
    expect(detail!.connections.whatsapp).toBeNull()
    expect(detail!.counts.services).toBe(2)
    expect(detail!.counts.customers).toBe(1)
    expect(JSON.stringify(detail!.connections)).not.toContain("accessToken")

    const problems = await recentProblems(scoped, now)
    expect(problems.map((p) => p.kind).sort()).toEqual(["bot", "scheduled", "whatsapp"])
    expect(problems.find((p) => p.kind === "bot")).toMatchObject({ detail: "overloaded_error", conversationId: conversation!.id })
    expect(problems.find((p) => p.kind === "whatsapp")?.detail).toContain("131047")

    const [row] = await recentConversations(scoped)
    expect(row).toMatchObject({ id: conversation!.id, customerName: "Lucía", isTest: false })

    const thread = await conversationThread(scoped, conversation!.id)
    expect(thread!.messages.map((m) => m.from)).toEqual(["cliente", "bot", "equipo"])
    expect(thread!.messages[1]).toMatchObject({
      botError: "overloaded_error",
      tools: [{ name: "check_availability", ok: false }],
    })

    // Otro negocio no ve esa conversación.
    const other = await seedSalon(db, "sop-otro")
    expect(await conversationThread(other.scoped, conversation!.id)).toBeNull()
  })

  it("extiende la prueba desde su fin (o desde hoy si ya venció) y lo audita", async () => {
    const salon = await seedSalon(db, "sop-prueba")
    const now = new Date("2026-11-10T12:00:00Z")
    const future = new Date(now.getTime() + 3 * DAY)
    await salon.scoped.updateBusiness({ trialEndsAt: future })

    const extended = await extendTrial(db, { businessId: salon.business.id, days: 7, actorId: salon.owner.id, now })
    expect(extended!.trialEndsAt!.getTime()).toBe(future.getTime() + 7 * DAY)

    await salon.scoped.updateBusiness({ trialEndsAt: new Date(now.getTime() - 5 * DAY) })
    const again = await extendTrial(db, { businessId: salon.business.id, days: 14, actorId: salon.owner.id, now })
    expect(again!.trialEndsAt!.getTime()).toBe(now.getTime() + 14 * DAY)

    const logs = await forBusiness(db, salon.business.id).auditLogs.findMany()
    expect(logs.filter((l) => l.action === "platform.trial_extended")).toHaveLength(2)
    expect(await extendTrial(db, { businessId: crypto.randomUUID(), days: 7, actorId: salon.owner.id, now })).toBeNull()
  })

  it("la ficha de un negocio que no existe es null", async () => {
    expect(await businessDetail(db, crypto.randomUUID(), new Date())).toBeNull()
    void schema
  })
})
