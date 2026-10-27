import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { invitationEmail } from "@/emails/invitation"
import { magicLinkEmail } from "@/emails/magic-link"
import { changeBookingStatus, createBooking, moveBooking, type Actor } from "@/lib/booking/create"
import { reminderTimes } from "@/lib/booking/customer-messages"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, forUser, type ScopedDb } from "@/lib/db/scoped"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { fillTemplate, templateDefinitions } from "@/lib/integrations/whatsapp/templates"
import { webhookPayload, parseWebhook } from "@/lib/integrations/whatsapp/webhook"
import {
  signResendBody,
  undeliverableAddresses,
  verifyResendSignature,
  resendEvent,
} from "@/lib/integrations/resend/webhook"
import { deliverPendingNotifications, notify, type DeliveryDeps, type PushMessage } from "@/lib/notifications/dispatch"
import { listNotifications, loadPrefs, markAllRead, openNotification, savePrefs, unreadCount } from "@/lib/notifications/inbox"
import { runHourlyForBusiness, sendDailySummary } from "@/lib/notifications/summaries"
import { isQuietTime, renderNotification } from "@/lib/notifications/types"
import { markWhatsAppBroken } from "@/lib/whatsapp/connection"
import { processWebhookEvents, type WhatsAppDeps } from "@/lib/whatsapp/inbound"
import { parseReminderButton, reminderButtonId, sendDueCustomerMessages } from "@/lib/whatsapp/scheduled"
import { createStaff } from "@/lib/catalog"
import { createTestDb, type TestDb } from "../helpers/db"
import { scriptedModel, seedSalon } from "../helpers/bot"

/*
 * Fase 4: recordatorios, avisos al equipo, resúmenes y correos, sin servicios
 * externos. Los canales (push, WhatsApp, correo) son simulaciones que anotan
 * lo que se mandó.
 */

let db: TestDb
let close: () => Promise<void>
let salon: Awaited<ReturnType<typeof seedSalon>>
let staffUser: schema.Membership & { email: string }
let staffResource: schema.Resource

// Lunes 2 de noviembre de 2026, 10:00 en Montevideo.
const NOW = new Date("2026-11-02T13:00:00Z")
const HOUR = 3_600_000
const PHONE_NUMBER_ID = "5551234"

const panel = (userId: string): Actor => ({ type: "user", id: userId, channel: "panel" })
const bot: Actor = { type: "bot", id: null, channel: "whatsapp" }

let wamidCounter = 0

function fakeChannels() {
  const pushes: { endpoint: string; message: PushMessage }[] = []
  const whatsapp: { to: string; payload: OutboundPayload }[] = []
  const emails: { to: string; subject: string; html: string; text: string }[] = []
  const gone = new Set<string>()
  const api: WhatsAppApi = {
    async send(to, payload) {
      whatsapp.push({ to, payload })
      // El wamid es único en toda la base: el contador es del archivo, no de cada simulación.
      return { wamid: `wamid.out.${++wamidCounter}` }
    },
    async markRead() {},
    async downloadMedia() {
      throw new Error("no")
    },
  }
  const deps: DeliveryDeps = {
    push: {
      async send(subscription, message) {
        if (gone.has(subscription.endpoint)) return "gone"
        pushes.push({ endpoint: subscription.endpoint, message })
        return "sent"
      },
    },
    email: {
      async send(input) {
        emails.push(input)
      },
    },
    whatsapp: () => api,
    appUrl: "https://app.responbot.test",
  }
  return { deps, api, pushes, whatsapp, emails, gone }
}

let channels: ReturnType<typeof fakeChannels>

async function connectWhatsApp(scoped: ScopedDb) {
  const existing = await scoped.whatsappAccounts.findFirst()
  if (existing) {
    await scoped.whatsappAccounts.update(undefined, { status: "active" })
    return
  }
  await scoped.whatsappAccounts.insert({
    wabaId: "WABA_N",
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhone: "+598 2900 0000",
    accessTokenEnc: "no-se-usa-en-tests",
    status: "active",
  })
}

async function newCustomer(scoped: ScopedDb, phone: string, name = "Lucía Pérez") {
  const [customer] = await scoped.customers.insert({ phoneE164: phone, name })
  return customer!
}

/** Turno del martes 3 a las 10:00 (24 horas después de NOW) con Ana. */
async function bookTomorrow(customerId: string, actor: Actor = panel(salon.owner.id), at = "2026-11-03T13:00:00Z") {
  return createBooking(
    salon.scoped,
    { customerId, resourceId: salon.ana.id, serviceId: salon.corte.id, startsAt: new Date(at), source: actor.type === "bot" ? "whatsapp" : "panel" },
    actor,
    { now: NOW },
  )
}

async function scheduledFor(bookingId: string) {
  return salon.scoped.scheduledMessages.findMany({
    where: eq(schema.scheduledMessages.bookingId, bookingId),
    orderBy: schema.scheduledMessages.createdAt,
  })
}

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  salon = await seedSalon(db, "avisos")
  await db.update(schema.users).set({ name: "Marcela Gómez" }).where(eq(schema.users.id, salon.owner.id))
  // Una profesional con cuenta: Carla ve solo su columna.
  const [carla] = await db.insert(schema.users).values({ email: "carla@example.com", name: "Carla" }).returning()
  const [membership] = await salon.scoped.memberships.insert({ userId: carla!.id, role: "staff" })
  staffUser = { ...membership!, email: carla!.email! }
  const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "19:00" }))
  staffResource = await createStaff(salon.scoped, { name: "Carla", serviceIds: [salon.corte.id], hours, userId: carla!.id })
})

afterAll(async () => {
  await close()
})

beforeEach(() => {
  channels = fakeChannels()
})

describe("textos y reglas de los avisos", () => {
  it("las horas de silencio cruzan la medianoche", () => {
    expect(isQuietTime(23 * 60, "22:00", "08:00")).toBe(true)
    expect(isQuietTime(7 * 60 + 59, "22:00", "08:00")).toBe(true)
    expect(isQuietTime(8 * 60, "22:00", "08:00")).toBe(false)
    expect(isQuietTime(13 * 60, "12:00", "14:00")).toBe(true)
    expect(isQuietTime(13 * 60, "10:00", "10:00")).toBe(false)
  })

  it("cada aviso tiene título, texto y destino", () => {
    const booking = {
      bookingId: "b",
      customerName: "Lucía",
      serviceName: "Corte",
      staffName: "Ana",
      date: "2026-11-03",
      day: "martes 3 de noviembre",
      time: "10:00",
    }
    expect(renderNotification("booking.created", { ...booking, byBot: true })).toEqual({
      title: "Reserva nueva por WhatsApp",
      body: "Lucía: Corte con Ana, martes 3 de noviembre a las 10:00.",
      url: "/app/agenda?fecha=2026-11-03",
    })
    expect(renderNotification("booking.changed", { ...booking, change: "cancelled", byCustomer: true }).title).toBe(
      "Turno cancelado por el cliente",
    )
    expect(
      renderNotification("conversation.handoff", {
        conversationId: "c",
        customerId: "x",
        customerName: null,
        reason: "Quiere hablar con alguien",
        test: false,
      }).url,
    ).toBe("/app/conversaciones/c")
  })

  it("los recordatorios salen según las reglas", () => {
    const startsAt = new Date("2026-11-03T13:00:00Z")
    expect(reminderTimes(startsAt, { reminderFirstHours: 24, reminderSecondHours: 2 })).toEqual({
      reminder_24h: new Date("2026-11-02T13:00:00Z"),
      reminder_2h: new Date("2026-11-03T11:00:00Z"),
    })
    expect(reminderTimes(startsAt, { reminderFirstHours: null, reminderSecondHours: 3 }).reminder_24h).toBeNull()
  })

  it("las plantillas nuevas tienen un ejemplo por variable", () => {
    for (const t of templateDefinitions) {
      const vars = new Set(t.body.match(/\{\{\d+\}\}/g))
      expect(t.example).toHaveLength(vars.size)
    }
    expect(fillTemplate("recordatorio_corto", ["Lucía", "10:00", "Corte", "Bulevar\nArtigas  1234"])).toBe(
      "Hola Lucía, te esperamos hoy a las 10:00 para tu turno de Corte en Bulevar Artigas 1234. Si no podés venir, avisanos por acá.",
    )
  })

  it("los botones de recordatorio se reconocen solo con un turno válido", () => {
    const id = "6f1c3c2e-6a7b-4b8e-9d2a-0c1e2f3a4b5c"
    expect(parseReminderButton(reminderButtonId("confirm", id))).toEqual({ action: "confirm", bookingId: id })
    expect(parseReminderButton("reminder:borrar:" + id)).toBeNull()
    expect(parseReminderButton("opcion_1")).toBeNull()
    expect(parseReminderButton(null)).toBeNull()
  })
})

describe("cambios de turno", () => {
  it("una reserva del panel programa recordatorios y la confirmación, y avisa al resto del equipo", async () => {
    const customer = await newCustomer(salon.scoped, "+59899000001")
    const booking = await bookTomorrow(customer.id, panel(staffUser.userId), "2026-11-03T14:00:00Z")
    const rows = await scheduledFor(booking.id)
    expect(rows.map((r) => [r.kind, r.sendAt.toISOString()]).sort()).toEqual([
      ["booking_confirmation", NOW.toISOString()],
      ["reminder_24h", "2026-11-02T14:00:00.000Z"],
      ["reminder_2h", "2026-11-03T12:00:00.000Z"],
    ].sort())
    // La reservó Carla (profesional) en la columna de Ana: le avisa a la dueña, no a Carla.
    const notifications = await salon.scoped.notifications.findMany({
      where: eq(schema.notifications.type, "booking.created"),
    })
    expect(notifications.map((n) => n.userId)).toEqual([salon.owner.id])
    expect(notifications[0]).toMatchObject({ channels: ["in_app", "push"], sentStatus: { push: "pending" } })
  })

  it("con poca anticipación solo va el recordatorio que todavía llega", async () => {
    const customer = await newCustomer(salon.scoped, "+59899000002")
    const booking = await bookTomorrow(customer.id, bot, "2026-11-02T17:00:00Z")
    const rows = await scheduledFor(booking.id)
    // El bot ya confirmó por chat: no se manda confirmación.
    expect(rows.map((r) => r.kind)).toEqual(["reminder_2h"])
  })

  it("mover reprograma los recordatorios y cancelar los anula y avisa al cliente", async () => {
    const customer = await newCustomer(salon.scoped, "+59899000003")
    const booking = await bookTomorrow(customer.id, panel(salon.owner.id), "2026-11-03T15:00:00Z")
    await moveBooking(
      salon.scoped,
      { bookingId: booking.id, startsAt: new Date("2026-11-04T13:00:00Z") },
      panel(salon.owner.id),
      { now: NOW },
    )
    let rows = await scheduledFor(booking.id)
    const pending = rows.filter((r) => r.status === "pending")
    expect(pending.find((r) => r.kind === "reminder_24h")?.sendAt.toISOString()).toBe("2026-11-03T13:00:00.000Z")
    expect(rows.filter((r) => r.kind === "reminder_24h")).toHaveLength(1)
    expect(pending.filter((r) => r.kind === "booking_confirmation")).toHaveLength(1)

    await changeBookingStatus(
      salon.scoped,
      { bookingId: booking.id, to: "cancelled", cancelReason: "Cerramos" },
      panel(salon.owner.id),
      { now: NOW },
    )
    rows = await scheduledFor(booking.id)
    expect(rows.filter((r) => r.status === "pending").map((r) => r.kind)).toEqual(["booking_cancelled"])
    // La dueña lo canceló: el aviso de cancelación no le llega a ella misma.
    const changed = await salon.scoped.notifications.findMany({ where: eq(schema.notifications.type, "booking.changed") })
    expect(changed.every((n) => n.userId !== salon.owner.id)).toBe(true)
  })

  it("los turnos del chat de prueba no programan nada", async () => {
    const [test] = await salon.scoped.customers.insert({ phoneE164: "test:avisos", isTest: true })
    const booking = await createBooking(
      salon.scoped,
      { customerId: test!.id, resourceId: salon.beto.id, serviceId: salon.corte.id, startsAt: new Date("2026-11-03T14:00:00Z"), source: "test_chat" },
      bot,
      { now: NOW },
    )
    expect(await scheduledFor(booking.id)).toHaveLength(0)
  })

  it("un turno de su columna le avisa a la profesional", async () => {
    const customer = await newCustomer(salon.scoped, "+59899000004")
    const booking = await createBooking(
      salon.scoped,
      { customerId: customer.id, resourceId: staffResource.id, serviceId: salon.corte.id, startsAt: new Date("2026-11-03T15:00:00Z"), source: "whatsapp" },
      bot,
      { now: NOW },
    )
    const rows = await salon.scoped.notifications.findMany({ where: eq(schema.notifications.type, "booking.created") })
    const mine = rows.filter((n) => (n.payload as { bookingId: string }).bookingId === booking.id)
    expect(mine.map((n) => n.userId).sort()).toEqual([salon.owner.id, staffUser.userId].sort())
  })
})

describe("despachador", () => {
  it("respeta preferencias, horas de silencio, WhatsApp y correos rebotados", async () => {
    const scoped = salon.scoped
    await forUser(db, salon.owner.id).setPhone("+59899555000")
    await savePrefs(scoped, salon.owner.id, "owner", {
      types: {
        "booking.created": { in_app: true, push: true, whatsapp: true, email: false },
        "conversation.handoff": { in_app: true, push: true, whatsapp: true, email: false },
      },
      quietStart: "22:00",
      quietEnd: "08:00",
    })
    // 23:30 en Montevideo: silencio.
    const night = new Date("2026-11-03T02:30:00Z")
    const base = { bookingId: "b", customerName: "L", serviceName: "Corte", staffName: "Ana", date: "2026-11-03", day: "martes", time: "10:00" }
    const [quiet] = await notify(scoped, { type: "booking.created", payload: { ...base, byBot: true }, now: night })
    expect(quiet!.channels).toEqual(["in_app"])
    const [handoff] = await notify(scoped, {
      type: "conversation.handoff",
      payload: { conversationId: "c", customerId: "x", customerName: "Lucía", reason: "Reclamo", test: false },
      now: night,
    })
    expect(handoff!.channels).toEqual(["in_app", "push", "whatsapp"])
    const [day] = await notify(scoped, { type: "booking.created", payload: { ...base, byBot: true }, now: NOW })
    expect(day!.channels).toEqual(["in_app", "push", "whatsapp"])

    // Correo rebotado: el aviso de WhatsApp desconectado no intenta el correo.
    await forPlatform(db).markEmailBounced("AVISOS@example.com", NOW)
    const [broken] = await notify(scoped, { type: "whatsapp.disconnected", payload: { status: "token_expired" }, now: NOW })
    expect(broken!.channels).toEqual(["in_app", "push"])
    await db.update(schema.users).set({ emailBouncedAt: null }).where(eq(schema.users.id, salon.owner.id))
  })

  it("entrega push, WhatsApp y correo una sola vez, y borra los dispositivos dados de baja", async () => {
    const scoped = salon.scoped
    await connectWhatsApp(scoped)
    const owner = forUser(db, salon.owner.id)
    await owner.savePushSubscription({ endpoint: "https://push.test/1", p256dh: "k", auth: "a", userAgent: null })
    await owner.savePushSubscription({ endpoint: "https://push.test/viejo", p256dh: "k", auth: "a", userAgent: null })
    channels.gone.add("https://push.test/viejo")
    // Despeja lo pendiente de pruebas anteriores.
    await scoped.notifications.update(undefined, { sentStatus: {} })

    const [row] = await notify(scoped, {
      type: "conversation.handoff",
      payload: { conversationId: "c1", customerId: "x", customerName: "Lucía", reason: "Quiere hablar con alguien", test: false },
      now: NOW,
    })
    await scoped.notificationPrefs.update(eq(schema.notificationPrefs.type, "whatsapp.disconnected"), { email: true })
    const [mail] = await notify(scoped, { type: "whatsapp.disconnected", payload: { status: "token_expired" }, now: NOW })
    expect(mail!.channels).toContain("email")

    const [first, second] = await Promise.all([
      deliverPendingNotifications(scoped, channels.deps, NOW),
      deliverPendingNotifications(scoped, channels.deps, NOW),
    ])
    expect(first.delivered + second.delivered).toBe(2)

    const delivered = await scoped.notifications.findById(row!.id)
    expect(delivered!.sentStatus).toEqual({ push: "sent", whatsapp: "sent" })
    expect(channels.pushes.filter((p) => p.message.tag === row!.id)).toHaveLength(1)
    expect(await owner.hasPushSubscription("https://push.test/viejo")).toBe(false)

    const template = channels.whatsapp.find((w) => w.payload.type === "template")!
    expect(template.to).toBe("+59899555000")
    expect(template.payload).toMatchObject({
      type: "template",
      template: {
        name: "aviso_derivacion_dueno",
        components: [{ type: "body", parameters: [{ text: "Marcela" }, { text: "Lucía" }, { text: "Quiere hablar con alguien" }] }],
      },
    })
    const email = channels.emails.find((e) => e.to === "avisos@example.com")!
    expect(email.subject).toContain("WhatsApp se desconectó")
    expect(email.html).toContain("https://app.responbot.test/app/configuracion#whatsapp")
    expect(email.html).toContain("/app/notificaciones")
    const usage = await scoped.usageCounters.findFirst()
    expect(usage?.templatesSent).toBeGreaterThanOrEqual(1)
  })

  it("sin canales configurados quedan como salteados", async () => {
    const scoped = salon.scoped
    await scoped.notifications.update(undefined, { sentStatus: {} })
    const [row] = await notify(scoped, {
      type: "booking.unconfirmed",
      payload: { bookingId: "b", customerName: "L", serviceName: "Corte", staffName: "Ana", date: "2026-11-03", day: "martes", time: "10:00" },
      now: NOW,
    })
    await deliverPendingNotifications(scoped, { push: null, email: null, whatsapp: null, appUrl: "" }, NOW)
    expect((await scoped.notifications.findById(row!.id))!.sentStatus).toEqual({ push: "skipped" })
  })

  it("WhatsApp desconectado avisa una sola vez", async () => {
    const other = await seedSalon(db, "avisos-roto")
    await other.scoped.whatsappAccounts.insert({
      wabaId: "WABA_R",
      phoneNumberId: "999",
      displayPhone: "+598",
      accessTokenEnc: "x",
    })
    expect(await markWhatsAppBroken(other.scoped, "token_expired", NOW)).toBe(true)
    expect(await markWhatsAppBroken(other.scoped, "token_expired", NOW)).toBe(false)
    const rows = await other.scoped.notifications.findMany()
    expect(rows.map((r) => r.type)).toEqual(["whatsapp.disconnected"])
    expect(rows[0]!.channels).toEqual(["in_app", "push", "email"])
  })
})

describe("mensajes programados al cliente", () => {
  async function freshBusiness(slug: string) {
    const s = await seedSalon(db, slug)
    await connectWhatsAppFor(s.scoped, slug)
    return s
  }

  async function connectWhatsAppFor(scoped: ScopedDb, id: string) {
    await scoped.whatsappAccounts.insert({
      wabaId: `WABA_${id}`,
      phoneNumberId: `PN_${id}`,
      displayPhone: "+598",
      accessTokenEnc: "x",
    })
  }

  it("fuera de la ventana de 24 horas va la plantilla con los botones; dentro, botones comunes", async () => {
    const s = await freshBusiness("recordatorios")
    const [lucia] = await s.scoped.customers.insert({ phoneE164: "+59899100100", name: "Lucía Pérez" })
    const [pedro] = await s.scoped.customers.insert({ phoneE164: "+59899100200", name: "Pedro" })
    // Pedro escribió hace un rato: la ventana está abierta.
    await s.scoped.conversations.insert({ customerId: pedro!.id, lastInboundAt: new Date(NOW.getTime() - HOUR) })

    const book = (customerId: string, at: string, resourceId = s.ana.id) =>
      createBooking(
        s.scoped,
        { customerId, resourceId, serviceId: s.corte.id, startsAt: new Date(at), source: "whatsapp" },
        bot,
        { now: new Date(NOW.getTime() - 2 * 86_400_000) },
      )
    const luciaBooking = await book(lucia!.id, "2026-11-03T13:00:00Z")
    await book(pedro!.id, "2026-11-03T14:00:00Z", s.beto.id)

    // Antes de la hora no sale nada.
    expect((await sendDueCustomerMessages(s.scoped, channels.deps, new Date(NOW.getTime() - HOUR))).sent).toBe(0)
    const result = await sendDueCustomerMessages(s.scoped, channels.deps, new Date(NOW.getTime() + HOUR + 60_000))
    expect(result).toEqual({ sent: 2, failed: 0, cancelled: 0 })

    const toLucia = channels.whatsapp.find((w) => w.to === "+59899100100")!
    expect(toLucia.payload).toMatchObject({
      type: "template",
      template: {
        name: "recordatorio_turno",
        components: [
          { type: "body" },
          { type: "button", index: "0", parameters: [{ payload: reminderButtonId("confirm", luciaBooking.id) }] },
          { type: "button", index: "1" },
          { type: "button", index: "2" },
        ],
      },
    })
    const toPedro = channels.whatsapp.find((w) => w.to === "+59899100200")!
    expect(toPedro.payload).toMatchObject({ type: "interactive", interactive: { type: "button" } })

    // Queda en la conversación con el texto de la plantilla.
    const conversation = await s.scoped.conversations.findFirst(eq(schema.conversations.customerId, lucia!.id))
    const [message] = await s.scoped.messages.findMany({ where: eq(schema.messages.conversationId, conversation!.id) })
    expect(message).toMatchObject({ type: "template", status: "sent", direction: "outbound" })
    expect(message!.body).toContain("te recordamos tu turno de Corte con Ana el martes 3 de noviembre a las 10:00")
    expect((await s.scoped.usageCounters.findFirst())?.templatesSent).toBe(1)

    // Una segunda vuelta no repite.
    expect((await sendDueCustomerMessages(s.scoped, channels.deps, new Date(NOW.getTime() + 2 * HOUR))).sent).toBe(0)
  })

  it("respeta la baja, la falta de WhatsApp y los recordatorios que llegan tarde", async () => {
    const s = await seedSalon(db, "recordatorios-2")
    const [baja] = await s.scoped.customers.insert({ phoneE164: "+59899200100", name: "Ana", optedOut: true })
    const [otro] = await s.scoped.customers.insert({ phoneE164: "+59899200200", name: "Juan" })
    const past = new Date(NOW.getTime() - 3 * 86_400_000)
    const book = (customerId: string, at: string) =>
      createBooking(
        s.scoped,
        { customerId, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: new Date(at), source: "whatsapp" },
        bot,
        { now: past },
      )
    const b1 = await book(baja!.id, "2026-11-03T13:00:00Z")
    const b2 = await book(otro!.id, "2026-11-03T14:00:00Z")

    // Sin WhatsApp conectado: falla con el motivo.
    let result = await sendDueCustomerMessages(s.scoped, channels.deps, new Date(NOW.getTime() + 2 * HOUR))
    expect(result).toMatchObject({ sent: 0, cancelled: 1, failed: 1 })
    expect((await scheduledFor2(s.scoped, b1.id)).find((r) => r.kind === "reminder_24h")).toMatchObject({
      status: "cancelled",
      lastError: "El cliente pidió no recibir recordatorios.",
    })
    expect((await scheduledFor2(s.scoped, b2.id)).find((r) => r.kind === "reminder_24h")).toMatchObject({
      status: "failed",
      lastError: "WhatsApp no está conectado.",
    })

    // El de 2 horas, procesado cinco horas tarde, ya no va.
    await connectWhatsAppFor(s.scoped, "r2")
    result = await sendDueCustomerMessages(s.scoped, channels.deps, new Date("2026-11-03T16:30:00Z"))
    expect(channels.whatsapp).toHaveLength(0)
    expect(result.cancelled).toBeGreaterThanOrEqual(1)
  })

  it("si no confirmó, el de 2 horas avisa al equipo", async () => {
    const s = await freshBusiness("sin-confirmar")
    const [c] = await s.scoped.customers.insert({ phoneE164: "+59899300100", name: "Sofía" })
    const booking = await createBooking(
      s.scoped,
      { customerId: c!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: new Date("2026-11-03T13:00:00Z"), source: "whatsapp" },
      bot,
      { now: new Date(NOW.getTime() - 2 * 86_400_000) },
    )
    await sendDueCustomerMessages(s.scoped, channels.deps, NOW)
    await sendDueCustomerMessages(s.scoped, channels.deps, new Date("2026-11-03T11:00:00Z"))
    expect(channels.whatsapp.map((w) => (w.payload.type === "template" ? w.payload.template.name : w.payload.type))).toEqual([
      "recordatorio_turno",
      "recordatorio_corto",
    ])
    const unconfirmed = await s.scoped.notifications.findMany({ where: eq(schema.notifications.type, "booking.unconfirmed") })
    expect(unconfirmed).toHaveLength(1)
    expect((unconfirmed[0]!.payload as { bookingId: string }).bookingId).toBe(booking.id)
  })

  it("Confirmo desde la plantilla confirma el turno sin IA; Cancelar se lo pasa al bot", async () => {
    const s = await freshBusiness("botones")
    const [c] = await s.scoped.customers.insert({ phoneE164: "+59899400100", name: "Lucía" })
    const book = (at: string) =>
      createBooking(
        s.scoped,
        { customerId: c!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: new Date(at), source: "whatsapp" },
        bot,
        { now: new Date(NOW.getTime() - 2 * 86_400_000) },
      )
    const first = await book("2026-11-03T13:00:00Z")
    const second = await book("2026-11-04T13:00:00Z")

    const event = (id: string, payload: string, text: string) =>
      parseWebhook(
        webhookPayload.parse({
          object: "whatsapp_business_account",
          entry: [
            {
              id: "WABA_botones",
              changes: [
                {
                  field: "messages",
                  value: {
                    metadata: { phone_number_id: "PN_botones" },
                    contacts: [{ wa_id: "59899400100", profile: { name: "Lucía" } }],
                    messages: [{ from: "59899400100", id, timestamp: "1793624400", type: "button", button: { payload, text } }],
                  },
                },
              ],
            },
          ],
        }),
      )
    const model = scriptedModel([{ text: "¿Querés que lo cancele?" }])
    let tick = 0
    const deps: WhatsAppDeps = {
      api: () => channels.api,
      model,
      transcriber: null,
      describer: null,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
    }
    const touched = await processWebhookEvents(db, event("wamid.b1", reminderButtonId("confirm", first.id), "Confirmo"), deps)
    expect(touched).toEqual([s.business.id])
    expect((await s.scoped.bookings.findById(first.id))!.status).toBe("client_confirmed")
    const reply = channels.whatsapp.at(-1)!
    expect(reply.payload).toEqual({ type: "text", text: "¡Gracias por confirmar! Te esperamos el martes 3 de noviembre a las 10:00." })
    expect(model.requests).toHaveLength(0)

    await processWebhookEvents(db, event("wamid.b2", reminderButtonId("cancel", second.id), "Cancelar"), deps)
    expect(model.requests).toHaveLength(1)
    const lastUser = model.requests[0]!.messages.at(-1)!
    expect(JSON.stringify(lastUser.content)).toContain("Quiero cancelar mi turno de Corte del miércoles 4 de noviembre a las 10:00.")
    expect((await s.scoped.bookings.findById(second.id))!.status).toBe("confirmed")
  })
})

async function scheduledFor2(scoped: ScopedDb, bookingId: string) {
  return scoped.scheduledMessages.findMany({ where: eq(schema.scheduledMessages.bookingId, bookingId) })
}

describe("resúmenes y correos de alta", () => {
  it("el resumen diario sale a las 8:00 locales, una vez, por WhatsApp al dueño", async () => {
    const s = await seedSalon(db, "resumen")
    await forUser(db, s.owner.id).setPhone("+59899700700")
    const [c] = await s.scoped.customers.insert({ phoneE164: "+59899700100", name: "Lucía" })
    // Martes 3: dos turnos, uno tomado por el bot el día anterior.
    const eight = new Date("2026-11-03T11:00:00Z")
    await createBooking(
      s.scoped,
      { customerId: c!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: new Date("2026-11-03T12:30:00Z"), source: "whatsapp" },
      bot,
      { now: new Date("2026-11-02T20:00:00Z") },
    )
    await createBooking(
      s.scoped,
      { customerId: c!.id, resourceId: s.beto.id, serviceId: s.corte.id, startsAt: new Date("2026-11-03T18:00:00Z"), source: "panel" },
      panel(s.owner.id),
      { now: new Date("2026-11-01T20:00:00Z") },
    )
    await s.scoped.bookings.update(undefined, { createdAt: new Date("2026-11-02T20:00:00Z") })

    // A las 9:00 no corre; a las 8:00 sí, y solo una vez.
    expect((await runHourlyForBusiness(s.scoped, "America/Montevideo", new Date("2026-11-03T12:00:00Z"), null, "")).daily).toBe(false)
    expect((await runHourlyForBusiness(s.scoped, "America/Montevideo", eight, null, "")).daily).toBe(true)
    expect(await sendDailySummary(s.scoped, eight)).toBe(false)

    const [summary] = await s.scoped.notifications.findMany({ where: eq(schema.notifications.type, "summary.daily") })
    expect(summary).toMatchObject({ userId: s.owner.id, channels: ["whatsapp"] })
    expect(summary!.payload).toMatchObject({ bookings: 2, firstTime: "09:30" })
    expect((summary!.payload as { botBookings: number }).botBookings).toBe(1)
  })

  it("el semanal va los lunes solo a quien lo pidió, y el de alta incompleta a las 24 horas", async () => {
    const s = await seedSalon(db, "semanal")
    await savePrefs(s.scoped, s.owner.id, "owner", {
      types: { "summary.weekly": { in_app: false, push: false, whatsapp: false, email: true } },
      quietStart: "22:00",
      quietEnd: "08:00",
    })
    await db.update(schema.businesses).set({ createdAt: new Date("2026-11-01T10:00:00Z") }).where(eq(schema.businesses.id, s.business.id))
    const monday8 = new Date("2026-11-02T11:00:00Z")
    const result = await runHourlyForBusiness(s.scoped, "America/Montevideo", monday8, channels.deps.email, "https://app.test")
    expect(result.weekly).toBe(true)
    expect(result.onboarding).toBe("onboarding_24h")
    const [weekly] = await s.scoped.notifications.findMany({ where: eq(schema.notifications.type, "summary.weekly") })
    expect(weekly).toMatchObject({ channels: ["email"] })
    const onboarding = channels.emails.find((e) => e.subject.includes("terminar el alta"))!
    expect(onboarding.to).toBe("semanal@example.com")
    expect(onboarding.html).toContain("https://app.test/onboarding/servicios")
    // No se repite.
    expect((await runHourlyForBusiness(s.scoped, "America/Montevideo", monday8, channels.deps.email, "https://app.test")).onboarding).toBeNull()
  })
})

describe("bandeja del panel", () => {
  it("lista, cuenta y marca como leídos solo los avisos de la persona", async () => {
    const scoped = forBusiness(db, salon.business.id)
    const before = await unreadCount(scoped, salon.owner.id)
    expect(before).toBeGreaterThan(0)
    const items = await listNotifications(scoped, salon.owner.id)
    expect(items.every((i) => i.title.length > 0)).toBe(true)
    expect(await openNotification(scoped, staffUser.userId, items[0]!.id)).toBeNull()
    expect(await openNotification(scoped, salon.owner.id, items[0]!.id)).toBe(items[0]!.url)
    expect(await unreadCount(scoped, salon.owner.id)).toBe(before - 1)
    await markAllRead(scoped, salon.owner.id)
    expect(await unreadCount(scoped, salon.owner.id)).toBe(0)
  })

  it("una profesional solo configura los avisos de sus turnos", async () => {
    const prefs = await loadPrefs(salon.scoped, staffUser.userId, "staff")
    expect(Object.keys(prefs.types).sort()).toEqual(["booking.changed", "booking.created", "booking.unconfirmed"])
    expect(prefs.types["booking.created"]).toEqual({ in_app: true, push: true, whatsapp: false, email: false })
    const owner = await loadPrefs(salon.scoped, salon.owner.id, "owner")
    expect(owner.types["booking.created"]!.whatsapp).toBe(true)
  })
})

describe("correos y webhook de Resend", () => {
  it("los correos salen en HTML y texto con React Email", async () => {
    const magic = await magicLinkEmail({ url: "https://app.test/api/auth/callback?token=abc&x=1", minutes: 15 })
    expect(magic.subject).toBe("Tu enlace para entrar a Responbot")
    expect(magic.html).toContain("https://app.test/api/auth/callback?token=abc&amp;x=1")
    expect(magic.text).toContain("15 minutos")
    const invite = await invitationEmail({ url: "https://app.test/login", inviterName: "Marcela", businessName: "Sol <3", roleLabel: "Admin", days: 7 })
    expect(invite.html).toContain("Sol &lt;3")
    expect(invite.text).toContain("vence en 7 días")
  })

  it("verifica la firma de Svix y marca los rebotes", async () => {
    const secret = `whsec_${Buffer.from("secreto-de-prueba").toString("base64")}`
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["Carla@example.com"] } })
    const timestamp = String(Math.floor(NOW.getTime() / 1000))
    const signature = `v1,${signResendBody(secret, "msg_1", timestamp, body)}`
    expect(verifyResendSignature(secret, { id: "msg_1", timestamp, signature }, body, NOW)).toBe(true)
    expect(verifyResendSignature(secret, { id: "msg_1", timestamp, signature }, body + " ", NOW)).toBe(false)
    expect(
      verifyResendSignature(secret, { id: "msg_1", timestamp, signature }, body, new Date(NOW.getTime() + 10 * 60_000)),
    ).toBe(false)

    const event = resendEvent.parse(JSON.parse(body))
    expect(undeliverableAddresses(event)).toEqual(["carla@example.com"])
    expect(undeliverableAddresses(resendEvent.parse({ type: "email.delivered", data: { to: ["x@y.z"] } }))).toEqual([])
    expect(await forPlatform(db).markEmailBounced("carla@example.com", NOW)).toBe(1)
    const [carla] = await db.select().from(schema.users).where(and(eq(schema.users.email, "carla@example.com")))
    expect(carla!.emailBouncedAt).not.toBeNull()
  })
})
