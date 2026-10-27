import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { plans } from "@/lib/billing/plans"
import { billingState, hasFeature, type BillingFields } from "@/lib/billing/state"
import { loadCatalog } from "@/lib/bot/catalog"
import { FeedbackError, rateBotReply, reviewedReplies } from "@/lib/bot/feedback"
import { fixedBlock } from "@/lib/bot/prompts/system"
import * as schema from "@/lib/db/schema"
import { forBusiness, type ScopedDb } from "@/lib/db/scoped"
import { isPlatformAdmin, parseAdminEmails } from "@/lib/pilots/admins"
import { createDemoBusiness, DEMO_NAME, resetDemoData, runDemoReset } from "@/lib/pilots/demo"
import { pilotMetrics, pilotOverview, setPilot } from "@/lib/pilots/overview"
import { reviewMarkdown } from "@/lib/pilots/review"
import { categoryByKey } from "@/lib/onboarding/templates"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon } from "../helpers/bot"

/*
 * Fase 7: negocios piloto, calificación de respuestas del bot, seguimiento
 * desde /admin, revisión en Markdown y demo pública.
 */

const NOW = new Date("2026-11-02T13:00:00Z")
const DAY = 86_400_000

let db: TestDb
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

/** Un cliente con una conversación: pregunta, respuesta del bot y respuesta del equipo. */
async function seedConversation(
  scoped: ScopedDb,
  phone: string,
  options: { isTest?: boolean; reply?: string; trace?: Record<string, unknown>; teamUserId?: string } = {},
) {
  const [customer] = await scoped.customers.insert({ phoneE164: phone, name: "Juana Pérez", isTest: options.isTest ?? false })
  const [conversation] = await scoped.conversations.insert({ customerId: customer!.id, lastInboundAt: new Date() })
  const [question] = await scoped.messages.insert({
    conversationId: conversation!.id,
    direction: "inbound",
    body: "¿Hacen alisado los domingos?",
    status: "received",
    createdAt: new Date(Date.now() - 60_000),
  })
  const [reply] = await scoped.messages.insert({
    conversationId: conversation!.id,
    direction: "outbound",
    body: options.reply ?? "Sí, los domingos de 9 a 13.",
    status: "sent",
    toolTrace: options.trace ?? { model: "x", rounds: 1, tools: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  })
  const team = options.teamUserId
    ? (
        await scoped.messages.insert({
          conversationId: conversation!.id,
          direction: "outbound",
          body: "Te escribo yo.",
          status: "sent",
          sentBy: options.teamUserId,
        })
      )[0]
    : undefined
  return { customer: customer!, conversation: conversation!, question: question!, reply: reply!, team }
}

describe("estado de cuenta de un piloto", () => {
  const base: BillingFields = { plan: "trial", trialEndsAt: new Date(NOW.getTime() - DAY), subscriptionStatus: null, paymentFailedAt: null }

  it("piloto vigente: todo habilitado con los límites del Equipo, aunque la prueba haya terminado", () => {
    const pilotEndsAt = new Date(NOW.getTime() + 30 * DAY)
    const state = billingState({ ...base, pilotEndsAt }, NOW)
    expect(state).toMatchObject({ status: "pilot", canBook: true, readOnly: false, pilotEndsAt })
    expect(state.plan.monthlyConversations).toBe(plans.team.monthlyConversations)
    expect(hasFeature(state, "reactivation")).toBe(true)
  })

  it("piloto vencido: vuelve a la regla de la prueba", () => {
    const state = billingState({ ...base, pilotEndsAt: new Date(NOW.getTime() - 1000) }, NOW)
    expect(state.status).toBe("trial_expired")
  })

  it("una suscripción paga activa manda sobre el piloto", () => {
    const state = billingState(
      { ...base, plan: "basic", subscriptionStatus: "active", pilotEndsAt: new Date(NOW.getTime() + DAY) },
      NOW,
    )
    expect(state.status).toBe("active")
    expect(state.plan.id).toBe("basic")
  })

  it("una suscripción impaga no bloquea a un piloto vigente", () => {
    const state = billingState(
      {
        ...base,
        plan: "pro",
        subscriptionStatus: "unpaid",
        paymentFailedAt: new Date(NOW.getTime() - 30 * DAY),
        pilotEndsAt: new Date(NOW.getTime() + DAY),
      },
      NOW,
    )
    expect(state).toMatchObject({ status: "pilot", canBook: true, readOnly: false })
  })

  it("la demo nunca vence", () => {
    const state = billingState({ ...base, isDemo: true }, NOW)
    expect(state).toMatchObject({ status: "pilot", canBook: true, pilotEndsAt: null })
  })
})

describe("calificar respuestas del bot", () => {
  it("guarda una opinión por respuesta y la reemplaza", async () => {
    const salon = await seedSalon(db, "fb-salon")
    const { reply } = await seedConversation(salon.scoped, "+59899000001")

    await rateBotReply(salon.scoped, { messageId: reply.id, rating: "good", note: null, userId: salon.owner.id })
    await rateBotReply(salon.scoped, {
      messageId: reply.id,
      rating: "bad",
      note: "  Los domingos está cerrado.  ",
      userId: salon.owner.id,
    })
    const rows = await salon.scoped.botFeedback.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rating: "bad", note: "Los domingos está cerrado." })

    const [item] = await reviewedReplies(salon.scoped, { rating: "bad" })
    expect(item).toMatchObject({
      customerText: "¿Hacen alisado los domingos?",
      reply: "Sí, los domingos de 9 a 13.",
      note: "Los domingos está cerrado.",
    })
  })

  it("no deja calificar mensajes del cliente ni del equipo", async () => {
    const salon = await seedSalon(db, "fb-only-bot")
    const { question, team } = await seedConversation(salon.scoped, "+59899000002", { teamUserId: salon.owner.id })
    for (const message of [question, team!]) {
      await expect(
        rateBotReply(salon.scoped, { messageId: message.id, rating: "bad", note: null, userId: salon.owner.id }),
      ).rejects.toBeInstanceOf(FeedbackError)
    }
  })

  it("no ve mensajes de otro negocio", async () => {
    const a = await seedSalon(db, "fb-a")
    const b = await seedSalon(db, "fb-b")
    const { reply } = await seedConversation(a.scoped, "+59899000003")
    await expect(
      rateBotReply(b.scoped, { messageId: reply.id, rating: "good", note: null, userId: b.owner.id }),
    ).rejects.toBeInstanceOf(FeedbackError)
  })
})

describe("seguimiento de los pilotos", () => {
  it("mide clientes, turnos del bot, derivaciones, errores y opiniones, sin el chat de prueba", async () => {
    const salon = await seedSalon(db, "metrics-salon")
    const scoped = salon.scoped
    const handoff = await seedConversation(scoped, "+59899000010", {
      trace: { model: "x", rounds: 2, tools: [{ name: "handoff_to_human", input: {}, ok: true, output: {} }], usage: {} },
    })
    await seedConversation(scoped, "+59899000011", { trace: { model: "x", rounds: 1, tools: [], usage: {}, error: "tiempo máximo" } })
    // El chat de prueba no cuenta, aunque derive.
    await seedConversation(scoped, "+59899000012", {
      isTest: true,
      trace: { model: "x", rounds: 1, tools: [{ name: "handoff_to_human", input: {}, ok: true, output: {} }], usage: {} },
    })
    await rateBotReply(scoped, { messageId: handoff.reply.id, rating: "bad", note: null, userId: salon.owner.id })
    const startsAt = new Date(Date.now() + 2 * DAY)
    await scoped.bookings.insert({
      customerId: handoff.customer.id,
      resourceId: salon.ana.id,
      serviceId: salon.corte.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      price: 60000,
      currency: "UYU",
      source: "whatsapp",
    })

    const metrics = await pilotMetrics(scoped, new Date(Date.now() - 7 * DAY))
    expect(metrics).toEqual({ conversations: 2, botBookings: 1, handoffs: 1, botErrors: 1, goodReplies: 0, badReplies: 1 })
  })

  it("marca y quita un piloto, con registro en la auditoría", async () => {
    const salon = await seedSalon(db, "pilot-set")
    const endsAt = new Date(Date.now() + 60 * DAY)
    await setPilot(db, { businessId: salon.business.id, endsAt, actorId: salon.owner.id })
    expect((await salon.scoped.business())!.pilotEndsAt).toEqual(endsAt)

    const row = (await pilotOverview(db, new Date())).find((r) => r.id === salon.business.id)
    expect(row).toMatchObject({ status: "pilot", planName: "Piloto", ownerEmail: "pilot-set@example.com" })

    await setPilot(db, { businessId: salon.business.id, endsAt: null, actorId: salon.owner.id })
    expect((await salon.scoped.business())!.pilotEndsAt).toBeNull()
    const logs = await salon.scoped.auditLogs.findMany({ orderBy: schema.auditLogs.createdAt })
    expect(logs.map((l) => l.action)).toEqual(["platform.pilot_set", "platform.pilot_removed"])
  })

  it("arma la revisión en Markdown con la nota y sin teléfonos ni nombres", async () => {
    const salon = await seedSalon(db, "review-salon")
    const { reply } = await seedConversation(salon.scoped, "+59899000020")
    await rateBotReply(salon.scoped, {
      messageId: reply.id,
      rating: "bad",
      note: "Los domingos está cerrado.",
      userId: salon.owner.id,
    })
    const markdown = await reviewMarkdown(db, new Date(Date.now() - DAY))
    expect(markdown).toContain("# Revisión del bot")
    expect(markdown).toContain("## Peluquería Sol")
    expect(markdown).toContain("- **Cliente:** ¿Hacen alisado los domingos?")
    expect(markdown).toContain("- **Bot:** Sí, los domingos de 9 a 13.")
    expect(markdown).toContain("> Tendría que haber dicho: Los domingos está cerrado.")
    expect(markdown).not.toContain("+59899000020")
    expect(markdown).not.toContain("Juana")
  })
})

describe("panel de la plataforma", () => {
  it("solo entran los emails de PLATFORM_ADMIN_EMAILS", () => {
    expect(parseAdminEmails(" Dario@Example.com, otro@example.com ,")).toEqual(["dario@example.com", "otro@example.com"])
    expect(isPlatformAdmin("dario@example.com", "DARIO@example.com")).toBe(true)
    expect(isPlatformAdmin("alguien@example.com", "dario@example.com")).toBe(false)
    expect(isPlatformAdmin("dario@example.com", undefined)).toBe(false)
  })
})

describe("demo pública", () => {
  it("crea una sola demo con servicios de barbería y dos profesionales", async () => {
    const [admin] = await db.insert(schema.users).values({ email: "admin-demo@example.com" }).returning()
    const demo = await createDemoBusiness(db, admin!.id, NOW)
    expect(demo).toMatchObject({ name: DEMO_NAME, isDemo: true, category: "barberia" })
    const scoped = forBusiness(db, demo.id)
    expect(await scoped.services.count()).toBe(categoryByKey("barberia")!.services.length)
    expect(await scoped.resources.count()).toBe(2)
    expect((await scoped.memberships.findFirst())?.role).toBe("owner")
    expect((await scoped.botSettings.findFirst())?.faq.length).toBeGreaterThan(0)

    const again = await createDemoBusiness(db, admin!.id, NOW)
    expect(again.id).toBe(demo.id)
  })

  it("el bot sabe que es la demo y comparte la web", async () => {
    const [demoId] = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.isDemo, true))
    const scoped = forBusiness(db, demoId!.id)
    const business = (await scoped.business())!
    const prompt = fixedBlock({
      business,
      rules: await scoped.bookingRules.findFirst(),
      settings: await scoped.botSettings.findFirst(),
      catalog: await loadCatalog(scoped, business.currency),
      demoUrl: "https://responbot.example",
    })
    expect(prompt).toContain("# Demo")
    expect(prompt).toContain("https://responbot.example")

    const salon = await seedSalon(db, "not-demo-prompt")
    const normal = fixedBlock({
      business: salon.business,
      rules: undefined,
      settings: undefined,
      catalog: await loadCatalog(salon.scoped, "UYU"),
      demoUrl: "https://responbot.example",
    })
    expect(normal).not.toContain("# Demo")
  })

  it("el borrado nocturno deja el catálogo y se lleva lo de los visitantes", async () => {
    const [demoId] = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.isDemo, true))
    const scoped = forBusiness(db, demoId!.id)
    const [resource] = await scoped.resources.findMany()
    const [service] = await scoped.services.findMany()
    const visitor = await seedConversation(scoped, "+59899000030")
    await rateBotReply(scoped, { messageId: visitor.reply.id, rating: "good", note: null, userId: (await scoped.members())[0]!.userId })
    await seedConversation(scoped, "+59899000031", { isTest: true })
    const startsAt = new Date(Date.now() + DAY)
    await scoped.bookings.insert({
      customerId: visitor.customer.id,
      resourceId: resource!.id,
      serviceId: service!.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      price: 55000,
      currency: "UYU",
      source: "whatsapp",
    })

    const [result] = await runDemoReset(db)
    expect(result).toMatchObject({ businessId: demoId!.id, customers: 1, bookings: 1 })
    expect(await scoped.customers.count(eq(schema.customers.isTest, false))).toBe(0)
    expect(await scoped.customers.count(eq(schema.customers.isTest, true))).toBe(1)
    expect(await scoped.bookings.count()).toBe(0)
    expect(await scoped.botFeedback.count()).toBe(0)
    expect(await scoped.conversations.count()).toBe(1)
    expect(await scoped.services.count()).toBeGreaterThan(0)
  })

  it("nunca borra un negocio que no es la demo", async () => {
    const salon = await seedSalon(db, "not-demo-reset")
    await expect(resetDemoData(salon.scoped)).rejects.toThrow()
  })
})
