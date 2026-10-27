import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { changeBookingStatus, refreshCustomerStats, type Actor } from "@/lib/booking/create"
import {
  parseReactivationButton,
  queueReactivations,
  REACTIVATION_DECLINED_REPLY,
  reactivationButtonId,
  reactivationReply,
} from "@/lib/booking/follow-ups"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { purgeOldMessages } from "@/lib/privacy"
import { computeMonthStats, monthBounds, previousMonth, type StatsBooking } from "@/lib/stats"
import { sendDueCustomerMessages } from "@/lib/whatsapp/scheduled"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon, TZ } from "../helpers/bot"

/*
 * Fase 6: estadísticas, reactivación de clientes, pedido de reseñas y
 * retención de mensajes.
 */

// Lunes 2 de noviembre de 2026, 10:00 en Montevideo.
const NOW = new Date("2026-11-02T13:00:00Z")
const DAY = 86_400_000
const panel = (userId: string): Actor => ({ type: "user", id: userId, channel: "panel" })

let db: TestDb
let close: () => Promise<void>
let wamid = 0

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

function fakeWhatsApp() {
  const sent: { to: string; payload: OutboundPayload }[] = []
  const api: WhatsAppApi = {
    async send(to, payload) {
      sent.push({ to, payload })
      return { wamid: `wamid.growth.${++wamid}` }
    },
    async markRead() {},
    async downloadMedia() {
      throw new Error("no")
    },
  }
  return { api, sent }
}

async function connectWhatsApp(scoped: ScopedDb, slug: string) {
  await scoped.whatsappAccounts.insert({
    wabaId: `WABA_${slug}`,
    phoneNumberId: `PN_${slug}`,
    displayPhone: "+598 2900 0000",
    accessTokenEnc: "no-se-usa",
    status: "active",
  })
}

describe("estadísticas del mes", () => {
  const at = (iso: string) => new Date(iso)
  const row = (startsAt: string, status: StatsBooking["status"], extra: Partial<StatsBooking> = {}): StatsBooking => ({
    startsAt: at(startsAt),
    createdAt: at("2026-10-01T15:00:00Z"),
    status,
    price: 60000,
    source: "panel",
    ...extra,
  })

  it("cuenta turnos, ingresos, inasistencias, horarios y reservas fuera de horario", () => {
    const rows = [
      // Martes 10:00 y 10:30, miércoles 10:00, sábado 15:00 (hora de Montevideo).
      row("2026-10-06T13:00:00Z", "completed"),
      row("2026-10-06T13:30:00Z", "no_show"),
      row("2026-10-07T13:00:00Z", "confirmed", { source: "whatsapp", createdAt: at("2026-10-05T02:00:00Z") }),
      row("2026-10-10T18:00:00Z", "completed", { source: "whatsapp", price: 180000 }),
      row("2026-10-13T13:00:00Z", "cancelled"),
      row("2026-10-14T13:00:00Z", "completed", { source: "test_chat" }),
    ]
    // Abierto de 9 a 19 hora local.
    const isOpenAt = (d: Date) => {
      const hour = (d.getUTCHours() + 21) % 24
      return hour >= 9 && hour < 19
    }
    const stats = computeMonthStats(rows, { timezone: TZ, isOpenAt })
    expect(stats).toMatchObject({
      bookings: 4,
      completed: 2,
      open: 1,
      noShows: 1,
      cancelled: 1,
      noShowRate: 33,
      revenue: 240000,
      pendingRevenue: 60000,
      byBot: 2,
      outsideHours: 1,
    })
    expect(stats.byHour).toEqual([
      { hour: 10, count: 3 },
      { hour: 15, count: 1 },
    ])
    expect(stats.byWeekday).toEqual([
      { weekday: 2, count: 2 },
      { weekday: 3, count: 1 },
      { weekday: 6, count: 1 },
    ])
    expect(stats.topSlots[0]).toEqual({ weekday: 2, hour: 10, count: 2 })
  })

  it("límites del mes", () => {
    expect(monthBounds("2026-12")).toEqual({ first: "2026-12-01", next: "2027-01-01" })
    expect(previousMonth("2026-01")).toBe("2025-12")
  })
})

/** Cliente con dos visitas atendidas (hace 75 y 40 días) con Ana. */
async function regularCustomer(salon: Awaited<ReturnType<typeof seedSalon>>, phone: string) {
  const [customer] = await salon.scoped.customers.insert({ phoneE164: phone, name: "Lucía Pérez" })
  for (const daysAgo of [75, 40]) {
    const startsAt = new Date(NOW.getTime() - daysAgo * DAY)
    await salon.scoped.bookings.insert({
      customerId: customer!.id,
      resourceId: salon.ana.id,
      serviceId: salon.corte.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: "completed",
      price: 60000,
      currency: "UYU",
      source: "panel",
    })
  }
  await refreshCustomerStats(salon.scoped, customer!.id)
  return (await salon.scoped.customers.findById(customer!.id))!
}

describe("reactivación de clientes", () => {
  it("invita a volver a quien pasó su intervalo, con su servicio y profesional, una sola vez", async () => {
    const salon = await seedSalon(db, "react-1")
    await connectWhatsApp(salon.scoped, "react-1")
    const customer = await regularCustomer(salon, "+59899300001")
    expect(customer.avgIntervalDays).toBe(35)

    expect(await queueReactivations(salon.scoped, NOW)).toBe(1)
    expect(await queueReactivations(salon.scoped, NOW)).toBe(0)

    const wa = fakeWhatsApp()
    const result = await sendDueCustomerMessages(salon.scoped, { whatsapp: () => wa.api }, NOW)
    expect(result.sent).toBe(1)
    const payload = wa.sent[0]!.payload
    expect(payload.type).toBe("template")
    if (payload.type !== "template") return
    expect(payload.template.name).toBe("reactivacion_cliente")
    const body = payload.template.components![0] as { parameters: { text: string }[] }
    expect(body.parameters.map((p) => p.text)).toEqual(["Lucía", "corte", "Ana"])
    const buttons = payload.template.components!.slice(1) as { parameters: { payload: string }[] }[]
    expect(buttons.map((b) => b.parameters[0]!.payload)).toEqual([
      reactivationButtonId("yes", customer.id),
      reactivationButtonId("no", customer.id),
    ])

    // Un mes después, sin visita nueva, no se repite (una por visita).
    expect(await queueReactivations(salon.scoped, new Date(NOW.getTime() + 31 * DAY))).toBe(0)
  })

  it("respeta el intervalo del servicio, la BAJA, los turnos próximos y el plan", async () => {
    const salon = await seedSalon(db, "react-2")
    await connectWhatsApp(salon.scoped, "react-2")
    const customer = await regularCustomer(salon, "+59899300002")

    // El corte se repite cada 8 semanas: todavía no corresponde.
    await salon.scoped.services.update(eq(schema.services.id, salon.corte.id), { rebookIntervalDays: 56 })
    expect(await queueReactivations(salon.scoped, NOW)).toBe(0)
    await salon.scoped.services.update(eq(schema.services.id, salon.corte.id), { rebookIntervalDays: null })

    await salon.scoped.customers.update(eq(schema.customers.id, customer.id), { optedOut: true })
    expect(await queueReactivations(salon.scoped, NOW)).toBe(0)
    await salon.scoped.customers.update(eq(schema.customers.id, customer.id), { optedOut: false })

    await salon.scoped.updateBusiness({ plan: "pro", subscriptionStatus: "active" })
    expect(await queueReactivations(salon.scoped, NOW)).toBe(0)
    await salon.scoped.updateBusiness({ plan: "team" })

    await salon.scoped.botSettings.update(undefined, { reactivationEnabled: false })
    expect(await queueReactivations(salon.scoped, NOW)).toBe(0)
    await salon.scoped.botSettings.update(undefined, { reactivationEnabled: true })

    // Con un turno ya reservado no se le escribe; si lo reserva después de encolada, no sale.
    expect(await queueReactivations(salon.scoped, NOW)).toBe(1)
    const startsAt = new Date(NOW.getTime() + 2 * DAY)
    await salon.scoped.bookings.insert({
      customerId: customer.id,
      resourceId: salon.ana.id,
      serviceId: salon.corte.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: "confirmed",
      price: 60000,
      currency: "UYU",
      source: "whatsapp",
    })
    const wa = fakeWhatsApp()
    const result = await sendDueCustomerMessages(salon.scoped, { whatsapp: () => wa.api }, NOW)
    expect(result).toMatchObject({ sent: 0, cancelled: 1 })
    expect(wa.sent).toHaveLength(0)
  })

  it("los botones: 'Sí, quiero' le pide el turno al bot y 'Ahora no' responde sin IA", async () => {
    const salon = await seedSalon(db, "react-3")
    const customer = await regularCustomer(salon, "+59899300003")
    const yes = parseReactivationButton(reactivationButtonId("yes", customer.id))!
    expect(await reactivationReply(salon.scoped, customer, yes, "Sí, quiero")).toEqual({
      text: "Quiero reservar un turno de corte con Ana.",
    })
    const no = parseReactivationButton(reactivationButtonId("no", customer.id))!
    expect(await reactivationReply(salon.scoped, customer, no, "Ahora no")).toEqual({
      text: "Ahora no",
      autoReply: REACTIVATION_DECLINED_REPLY,
    })
    expect(parseReactivationButton("reminder:confirm:x")).toBeNull()
  })
})

describe("pedido de reseñas", () => {
  it("al marcar atendido encola la reseña con el enlace, una vez cada 90 días, y se cancela si se corrige", async () => {
    const salon = await seedSalon(db, "review-1")
    await connectWhatsApp(salon.scoped, "review-1")
    await salon.scoped.botSettings.update(undefined, {
      reviewRequestEnabled: true,
      reviewUrl: "https://g.page/r/sol/review",
      reviewDelayHours: 2,
    })
    const [customer] = await salon.scoped.customers.insert({ phoneE164: "+59899400001", name: "Marta" })
    const book = async (hoursAgo: number) => {
      const startsAt = new Date(NOW.getTime() - hoursAgo * 3_600_000)
      const [booking] = await salon.scoped.bookings.insert({
        customerId: customer!.id,
        resourceId: salon.ana.id,
        serviceId: salon.corte.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        status: "confirmed",
        price: 60000,
        currency: "UYU",
        source: "panel",
      })
      return booking!
    }

    const first = await book(1)
    await changeBookingStatus(salon.scoped, { bookingId: first.id, to: "completed" }, panel(salon.owner.id), { now: NOW })
    const queued = await salon.scoped.scheduledMessages.findMany({
      where: and(eq(schema.scheduledMessages.kind, "post_service"), eq(schema.scheduledMessages.customerId, customer!.id)),
    })
    expect(queued).toHaveLength(1)
    expect(queued[0]!.sendAt.getTime()).toBe(NOW.getTime() + 2 * 3_600_000)

    // Antes de tiempo no sale; a las 2 horas, con la plantilla y el enlace.
    const wa = fakeWhatsApp()
    expect((await sendDueCustomerMessages(salon.scoped, { whatsapp: () => wa.api }, NOW)).sent).toBe(0)
    const later = new Date(NOW.getTime() + 2 * 3_600_000)
    expect((await sendDueCustomerMessages(salon.scoped, { whatsapp: () => wa.api }, later)).sent).toBe(1)
    const payload = wa.sent[0]!.payload
    expect(payload.type === "template" && payload.template.name).toBe("pedido_resena")
    if (payload.type === "template") {
      const body = payload.template.components![0] as { parameters: { text: string }[] }
      expect(body.parameters.map((p) => p.text)).toEqual(["Marta", "Peluquería Sol", "https://g.page/r/sol/review"])
    }

    // Otra visita al día siguiente: no se vuelve a pedir.
    const second = await book(0.5)
    await changeBookingStatus(salon.scoped, { bookingId: second.id, to: "completed" }, panel(salon.owner.id), {
      now: new Date(NOW.getTime() + DAY),
    })
    const all = await salon.scoped.scheduledMessages.count(eq(schema.scheduledMessages.kind, "post_service"))
    expect(all).toBe(1)
  })

  it("no se pide si está apagado, si el cliente pidió BAJA o si se marca atendido días después", async () => {
    const salon = await seedSalon(db, "review-2")
    const [customer] = await salon.scoped.customers.insert({ phoneE164: "+59899400002", name: "Pía" })
    const book = async (hoursAgo: number) => {
      const startsAt = new Date(NOW.getTime() - hoursAgo * 3_600_000)
      const [booking] = await salon.scoped.bookings.insert({
        customerId: customer!.id,
        resourceId: salon.ana.id,
        serviceId: salon.corte.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        status: "confirmed",
        price: 60000,
        currency: "UYU",
        source: "panel",
      })
      return booking!
    }
    const complete = (id: string) =>
      changeBookingStatus(salon.scoped, { bookingId: id, to: "completed" }, panel(salon.owner.id), { now: NOW })
    const count = () => salon.scoped.scheduledMessages.count(eq(schema.scheduledMessages.kind, "post_service"))

    await complete((await book(1)).id)
    expect(await count()).toBe(0)

    await salon.scoped.botSettings.update(undefined, { reviewRequestEnabled: true, reviewUrl: "https://g.page/r/x/review" })
    await complete((await book(5 * 24)).id)
    expect(await count()).toBe(0)

    await salon.scoped.customers.update(eq(schema.customers.id, customer!.id), { optedOut: true })
    await complete((await book(2)).id)
    expect(await count()).toBe(0)

    await salon.scoped.customers.update(eq(schema.customers.id, customer!.id), { optedOut: false })
    await complete((await book(3)).id)
    expect(await count()).toBe(1)
  })
})

describe("retención de mensajes", () => {
  it("borra los mensajes de más de 12 meses", async () => {
    const salon = await seedSalon(db, "purge-1")
    const [customer] = await salon.scoped.customers.insert({ phoneE164: "+59899500001", name: "Leo" })
    const [conversation] = await salon.scoped.conversations.insert({ customerId: customer!.id })
    await salon.scoped.messages.insert([
      { conversationId: conversation!.id, direction: "inbound", body: "viejo", status: "received", createdAt: new Date(NOW.getTime() - 400 * DAY) },
      { conversationId: conversation!.id, direction: "inbound", body: "nuevo", status: "received", createdAt: new Date(NOW.getTime() - 10 * DAY) },
    ])
    expect(await purgeOldMessages(salon.scoped, NOW)).toBe(1)
    const left = await salon.scoped.messages.findMany()
    expect(left.map((m) => m.body)).toEqual(["nuevo"])
  })
})
