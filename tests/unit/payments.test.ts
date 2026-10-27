import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { runTool, type ToolContext } from "@/lib/bot/tools"
import { changeBookingStatus, createBooking, type Actor } from "@/lib/booking/create"
import { acceptWaitlistOffer, parseWaitlistButton, waitlistButtonId } from "@/lib/booking/waitlist"
import * as schema from "@/lib/db/schema"
import { forPlatform, tenantTables, type ScopedDb } from "@/lib/db/scoped"
import {
  authorizationUrl,
  MercadoPagoError,
  preferenceBody,
  type MercadoPagoApi,
  type MpPayment,
  type PreferenceInput,
} from "@/lib/integrations/mercadopago/api"
import { signatureManifest, signMpNotification, verifyMpSignature } from "@/lib/integrations/mercadopago/webhook"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { fillTemplate, templateDefinitions } from "@/lib/integrations/whatsapp/templates"
import { formatMoney } from "@/lib/money"
import { depositFor } from "@/lib/payments/deposits"
import {
  accessToken,
  applyPayment,
  ensurePaymentLink,
  expireHolds,
  processPendingRefunds,
  refundAllowedByPolicy,
  requestDepositRefund,
  saveMpConnection,
  PaymentError,
  type PaymentDeps,
} from "@/lib/payments/mercadopago"
import { sendDueCustomerMessages } from "@/lib/whatsapp/scheduled"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon } from "../helpers/bot"

/*
 * Fase 5: señas con Mercado Pago y lista de espera, sin servicios externos.
 * Mercado Pago y WhatsApp son simulaciones que anotan lo que se pidió.
 */

// Lunes 2 de noviembre de 2026, 10:00 en Montevideo.
const NOW = new Date("2026-11-02T13:00:00Z")
const MINUTE = 60_000
/** Martes 3 a las 10:00 y 10:30 en Montevideo. */
const TUE_10 = new Date("2026-11-03T13:00:00Z")
const TUE_1030 = new Date("2026-11-03T13:30:00Z")

const panel = (userId: string): Actor => ({ type: "user", id: userId, channel: "panel" })
const bot: Actor = { type: "bot", id: null, channel: "whatsapp" }

let db: TestDb
let close: () => Promise<void>
let wamidCounter = 0
let mpUserCounter = 1000

function fakeMercadoPago() {
  const preferences: PreferenceInput[] = []
  const refunds: string[] = []
  const searches: Record<string, MpPayment[]> = {}
  const payments: Record<string, MpPayment> = {}
  let refreshError: Error | null = null
  let refreshed = 0
  const api: MercadoPagoApi = {
    async createPreference(_token, input) {
      preferences.push(input)
      return { id: `pref-${preferences.length}`, init_point: `https://mp.test/pagar/${input.bookingId}` }
    },
    async getPayment(_token, id) {
      const payment = payments[id]
      if (!payment) throw new MercadoPagoError("not found", 404)
      return payment
    },
    async searchPayments(_token, bookingId) {
      return searches[bookingId] ?? []
    },
    async refundPayment(_token, id) {
      refunds.push(id)
      return { id: 1, amount: 0, status: "approved" }
    },
    async refreshTokens() {
      if (refreshError) throw refreshError
      refreshed++
      return { access_token: "nuevo", refresh_token: "nuevo-refresh", expires_in: 15_552_000, user_id: 1 }
    },
  }
  const deps: PaymentDeps = {
    api,
    encrypt: (v) => `enc:${v}`,
    decrypt: (v) => v.replace(/^enc:/, ""),
    notificationUrl: "https://app.responbot.test/api/webhooks/mercadopago",
    backUrl: "https://app.responbot.test/pago",
  }
  return {
    deps,
    preferences,
    refunds,
    searches,
    payments,
    failRefresh: (error: Error | null) => (refreshError = error),
    refreshed: () => refreshed,
  }
}

function fakeWhatsApp() {
  const sent: { to: string; payload: OutboundPayload }[] = []
  const api: WhatsAppApi = {
    async send(to, payload) {
      sent.push({ to, payload })
      return { wamid: `wamid.pay.${++wamidCounter}` }
    },
    async markRead() {},
    async downloadMedia() {
      throw new Error("no")
    },
  }
  return { api, sent }
}

/** Negocio con seña del 50 %, Mercado Pago y WhatsApp conectados. */
async function setup(slug: string) {
  const salon = await seedSalon(db, slug)
  await salon.scoped.bookingRules.update(undefined, {
    depositMode: "percent",
    depositValue: 50,
    holdMinutes: 15,
    cancelHours: 24,
  })
  const mp = fakeMercadoPago()
  await saveMpConnection(
    salon.scoped,
    salon.owner.id,
    {
      tokens: { access_token: "tok", refresh_token: "ref", expires_in: 15_552_000, user_id: ++mpUserCounter },
      displayName: "sol@example.com",
    },
    mp.deps.encrypt,
    NOW,
  )
  await salon.scoped.whatsappAccounts.insert({
    wabaId: `WABA_${slug}`,
    phoneNumberId: `PN_${slug}`,
    displayPhone: "+598 2900 0000",
    accessTokenEnc: "no-se-usa",
    status: "active",
  })
  const wa = fakeWhatsApp()
  const [customer] = await salon.scoped.customers.insert({ phoneE164: `+5989${mpUserCounter}1`, name: "Lucía Pérez" })
  return { ...salon, mp, wa, customer: customer!, scheduled: { whatsapp: () => wa.api, payments: mp.deps } }
}

type Setup = Awaited<ReturnType<typeof setup>>

async function heldBooking(s: Setup, startsAt = TUE_10, customerId = s.customer.id) {
  return createBooking(
    s.scoped,
    { customerId, resourceId: s.ana.id, serviceId: s.corte.id, startsAt, source: "whatsapp", requestDeposit: true },
    bot,
    { now: NOW },
  )
}

async function scheduled(scoped: ScopedDb, kind: schema.ScheduledMessage["kind"]) {
  return scoped.scheduledMessages.findMany({ where: eq(schema.scheduledMessages.kind, kind) })
}

const approved = (bookingId: string, id: string, amount = 300): MpPayment => ({
  id,
  status: "approved",
  external_reference: bookingId,
  transaction_amount: amount,
  currency_id: "UYU",
})

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

describe("cuánto es la seña", () => {
  const rules = { depositMode: "percent" as const, depositValue: 50, noShowDepositThreshold: null }

  it("usa la regla general, la del servicio y nunca más que el precio", () => {
    expect(depositFor({ rules, price: 60000, depositOverride: null })).toBe(30000)
    expect(depositFor({ rules: { ...rules, depositMode: "fixed", depositValue: 20000 }, price: 60000, depositOverride: null })).toBe(20000)
    expect(depositFor({ rules, price: 60000, depositOverride: 0 })).toBe(0)
    expect(depositFor({ rules, price: 60000, depositOverride: 90000 })).toBe(60000)
    expect(depositFor({ rules, price: 0, depositOverride: null })).toBe(0)
    expect(depositFor({ rules: { ...rules, depositMode: "none" }, price: 60000, depositOverride: null })).toBe(0)
  })

  it("pide la seña general a quien faltó varias veces aunque el servicio no la pida", () => {
    const strict = { ...rules, noShowDepositThreshold: 2 }
    expect(depositFor({ rules: strict, price: 60000, depositOverride: 0, customerNoShows: 1 })).toBe(0)
    expect(depositFor({ rules: strict, price: 60000, depositOverride: 0, customerNoShows: 2 })).toBe(30000)
  })
})

describe("API de Mercado Pago", () => {
  it("valida la firma x-signature con el manifiesto oficial", () => {
    expect(signatureManifest({ dataId: "ABC123", requestId: "req-1", ts: "1700" })).toBe("id:abc123;request-id:req-1;ts:1700;")
    expect(signatureManifest({ dataId: null, requestId: null, ts: "1700" })).toBe("ts:1700;")
    const header = signMpNotification({ dataId: "123", requestId: "req-1", ts: "1700", secret: "s3cr3t" })
    expect(verifyMpSignature({ header, requestId: "req-1", dataId: "123", secret: "s3cr3t" })).toBe(true)
    expect(verifyMpSignature({ header, requestId: "req-1", dataId: "124", secret: "s3cr3t" })).toBe(false)
    expect(verifyMpSignature({ header, requestId: "req-1", dataId: "123", secret: "otra" })).toBe(false)
    expect(verifyMpSignature({ header: null, requestId: "req-1", dataId: "123", secret: "s3cr3t" })).toBe(false)
  })

  it("arma la preferencia con external_reference, webhook y vencimiento de la retención", () => {
    const expiresAt = new Date("2026-11-02T13:15:00Z")
    const body = preferenceBody({
      bookingId: "b1",
      title: "Seña: Corte",
      amount: 30050,
      currency: "UYU",
      notificationUrl: "https://x.test/api/webhooks/mercadopago",
      expiresAt,
    })
    expect(body).toMatchObject({
      external_reference: "b1",
      notification_url: "https://x.test/api/webhooks/mercadopago",
      expires: true,
      expiration_date_to: expiresAt.toISOString(),
      items: [{ quantity: 1, currency_id: "UYU", unit_price: 300.5 }],
    })
  })

  it("pide autorización con PKCE", () => {
    const url = new URL(authorizationUrl({ clientId: "123" }, { redirectUri: "https://x.test/cb", state: "st", codeChallenge: "ch" }))
    expect(url.origin).toBe("https://auth.mercadopago.com")
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "123",
      response_type: "code",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    })
  })

  it("las plantillas nuevas tienen un ejemplo por variable", () => {
    for (const name of ["sena_pendiente", "retencion_vencida", "sena_devuelta", "lugar_tomado"]) {
      const t = templateDefinitions.find((d) => d.name === name)!
      expect(t.body.match(/\{\{\d+\}\}/g)).toHaveLength(t.example.length)
    }
  })
})

describe("retención y pago", () => {
  it("un turno del bot con seña queda retenido y el link sale por WhatsApp", async () => {
    const s = await setup("retencion")
    const booking = await heldBooking(s)
    expect(booking).toMatchObject({ status: "pending_payment", depositStatus: "pending", depositAmount: 30000 })
    expect(booking.holdExpiresAt).toEqual(new Date(NOW.getTime() + 15 * MINUTE))

    const result = await sendDueCustomerMessages(s.scoped, s.scheduled, NOW)
    expect(result.sent).toBe(1)
    expect(s.mp.preferences).toHaveLength(1)
    expect(s.mp.preferences[0]).toMatchObject({ bookingId: booking.id, amount: 30000, expiresAt: booking.holdExpiresAt })
    const message = s.wa.sent.at(-1)!
    // Fuera de la ventana de 24 horas: plantilla con el link y la hora límite.
    expect(message.payload.type).toBe("template")
    expect(JSON.stringify(message.payload)).toContain(`https://mp.test/pagar/${booking.id}`)
    expect(JSON.stringify(message.payload)).toContain("10:15")
    expect((await s.scoped.bookings.findById(booking.id))!.paymentUrl).toBe(`https://mp.test/pagar/${booking.id}`)
  })

  it("sin Mercado Pago conectado, o desde el chat de prueba, se confirma sin seña", async () => {
    const s = await setup("sin-mp")
    await s.scoped.mpAccounts.update(undefined, { status: "token_expired" })
    const booking = await heldBooking(s)
    expect(booking).toMatchObject({ status: "confirmed", depositStatus: "none", depositAmount: 0 })
  })

  it("el pago aprobado confirma el turno, avisa al equipo y al cliente; un reintento no repite nada", async () => {
    const s = await setup("pago")
    const booking = await heldBooking(s)
    expect(await applyPayment(s.scoped, approved(booking.id, "pay-1"), NOW)).toBe("confirmed")
    const confirmed = (await s.scoped.bookings.findById(booking.id))!
    expect(confirmed).toMatchObject({ status: "confirmed", depositStatus: "paid" })
    expect(await s.scoped.payments.count()).toBe(1)
    expect(await s.scoped.notifications.count(eq(schema.notifications.type, "deposit.paid"))).toBe(1)
    expect(await scheduled(s.scoped, "booking_confirmation")).toHaveLength(1)

    expect(await applyPayment(s.scoped, approved(booking.id, "pay-1"), NOW)).toBe("recorded")
    expect(await s.scoped.payments.count()).toBe(1)
    expect(await s.scoped.notifications.count(eq(schema.notifications.type, "deposit.paid"))).toBe(1)
  })

  it("no confirma con un pago por menos de la seña ni de otro turno", async () => {
    const s = await setup("monto")
    const booking = await heldBooking(s)
    expect(await applyPayment(s.scoped, approved(booking.id, "pay-poco", 100), NOW)).toBe("recorded")
    expect(await applyPayment(s.scoped, approved("no-es-un-turno", "pay-x"), NOW)).toBe("ignored")
    expect((await s.scoped.bookings.findById(booking.id))!.status).toBe("pending_payment")
  })

  it("vence la retención sin pago: libera el horario y avisa al cliente", async () => {
    const s = await setup("vence")
    const booking = await heldBooking(s)
    const later = new Date(NOW.getTime() + 16 * MINUTE)
    expect(await forPlatform(db).businessesWithExpiredHolds(later)).toContain(s.business.id)
    expect(await expireHolds(s.scoped, s.mp.deps, later)).toEqual({ expired: 1, paid: 0 })
    expect((await s.scoped.bookings.findById(booking.id))!.status).toBe("expired")
    expect(await scheduled(s.scoped, "hold_expired")).toHaveLength(1)
    // El link pendiente ya no sale.
    await sendDueCustomerMessages(s.scoped, s.scheduled, later)
    expect(s.mp.preferences).toHaveLength(0)
    const texts = s.wa.sent.map((m) => JSON.stringify(m.payload))
    expect(texts.some((t) => t.includes("retencion_vencida"))).toBe(true)
    // El horario quedó libre.
    await createBooking(
      s.scoped,
      { customerId: s.customer.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: TUE_10, source: "panel" },
      panel(s.owner.id),
      { now: later },
    )
  })

  it("antes de vencer pregunta a Mercado Pago, por si el aviso se perdió", async () => {
    const s = await setup("perdido")
    const booking = await heldBooking(s)
    s.mp.searches[booking.id] = [approved(booking.id, "pay-perdido")]
    expect(await expireHolds(s.scoped, s.mp.deps, new Date(NOW.getTime() + 16 * MINUTE))).toEqual({ expired: 0, paid: 1 })
    expect((await s.scoped.bookings.findById(booking.id))!.status).toBe("confirmed")
  })

  it("si paga tarde y el horario se ocupó, la seña se devuelve sola", async () => {
    const s = await setup("tarde")
    const booking = await heldBooking(s)
    const later = new Date(NOW.getTime() + 16 * MINUTE)
    await expireHolds(s.scoped, null, later)
    const [other] = await s.scoped.customers.insert({ phoneE164: "+59899111222", name: "Otra" })
    await createBooking(
      s.scoped,
      { customerId: other!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: TUE_10, source: "panel" },
      panel(s.owner.id),
      { now: later },
    )
    expect(await applyPayment(s.scoped, approved(booking.id, "pay-tarde"), later)).toBe("refund_requested")
    expect(await processPendingRefunds(s.scoped, s.mp.deps, later)).toEqual({ refunded: 1, failed: 0 })
    expect(s.mp.refunds).toEqual(["pay-tarde"])
    expect((await s.scoped.bookings.findById(booking.id))!.depositStatus).toBe("refunded")
    expect(await scheduled(s.scoped, "deposit_refunded")).toHaveLength(1)
  })

  it("si paga tarde y el horario sigue libre, el turno vuelve", async () => {
    const s = await setup("revive")
    const booking = await heldBooking(s)
    const later = new Date(NOW.getTime() + 16 * MINUTE)
    await expireHolds(s.scoped, null, later)
    expect(await applyPayment(s.scoped, approved(booking.id, "pay-revive"), later)).toBe("confirmed")
    expect((await s.scoped.bookings.findById(booking.id))!).toMatchObject({ status: "confirmed", depositStatus: "paid" })
  })
})

describe("devoluciones", () => {
  async function paidBooking(s: Setup, startsAt = TUE_10) {
    const booking = await heldBooking(s, startsAt)
    await applyPayment(s.scoped, approved(booking.id, `pay-${booking.id}`), NOW)
    return booking
  }

  async function botContext(s: Setup, now = NOW): Promise<ToolContext> {
    const conversation = (
      await s.scoped.conversations.insert({ customerId: s.customer.id }).catch(async () => [
        await s.scoped.conversations.findFirst(eq(schema.conversations.customerId, s.customer.id)),
      ])
    )[0]!
    return {
      scoped: s.scoped,
      business: (await s.scoped.business())!,
      rules: await s.scoped.bookingRules.findFirst(),
      settings: await s.scoped.botSettings.findFirst(),
      customer: (await s.scoped.customers.findById(s.customer.id))!,
      conversation,
      channel: "whatsapp",
      now,
      canBook: true,
      choices: null,
    }
  }

  it("el bot cancela a tiempo y la seña se devuelve; fuera de plazo, no", async () => {
    const s = await setup("cancela-bot")
    const onTime = await paidBooking(s, new Date("2026-11-04T13:00:00Z"))
    const ctx = await botContext(s)
    const result = (await runTool("cancel_booking", { booking_id: onTime.id }, ctx)) as {
      output: { deposit_refund: boolean; hint: string }
    }
    expect(result.output.deposit_refund).toBe(true)
    expect(result.output.hint).toContain("se le devuelve")
    expect((await s.scoped.payments.findFirst(eq(schema.payments.bookingId, onTime.id)))!.refundStatus).toBe("pending")

    const late = await paidBooking(s, new Date("2026-11-02T18:00:00Z"))
    const lateResult = (await runTool("cancel_booking", { booking_id: late.id }, ctx)) as {
      output: { deposit_refund: boolean; late_cancellation: boolean; hint: string }
    }
    expect(lateResult.output).toMatchObject({ deposit_refund: false, late_cancellation: true })
    expect(lateResult.output.hint).toContain("no se devuelve")
  })

  it("el bot avisa la seña al reservar y no escribe el link", async () => {
    const s = await setup("bot-sena")
    const ctx = await botContext(s)
    const result = (await runTool("create_booking", { service_id: s.corte.id, staff_id: s.ana.id, date: "2026-11-03", time: "10:00" }, ctx)) as {
      ok: boolean
      output: Record<string, unknown>
    }
    expect(result.ok).toBe(true)
    expect(result.output).toMatchObject({ deposit_required: true, status: "pending_payment", deposit: formatMoney(30000, "UYU"), hold_until: "10:15" })
    const info = (await runTool("get_business_info", {}, ctx)) as { output: { policies: { deposit: string } } }
    expect(info.output.policies.deposit).toContain("50 %")
    const services = (await runTool("list_services", {}, ctx)) as { output: { services: { name: string; deposit?: string }[] } }
    expect(services.output.services.find((x) => x.name === "Corte")!.deposit).toBe(formatMoney(30000, "UYU"))
  })

  it("la política: el negocio siempre puede devolver; el cliente, solo con anticipación", () => {
    const booking = { status: "cancelled" as const, startsAt: TUE_10 }
    const base = { booking, cancelHours: 24 }
    expect(refundAllowedByPolicy({ ...base, cancelledBy: "user", cancelledAt: new Date("2026-11-03T12:00:00Z") })).toBe(true)
    expect(refundAllowedByPolicy({ ...base, cancelledBy: "bot", cancelledAt: new Date("2026-11-02T12:00:00Z") })).toBe(true)
    expect(refundAllowedByPolicy({ ...base, cancelledBy: "bot", cancelledAt: new Date("2026-11-02T14:00:00Z") })).toBe(false)
    expect(refundAllowedByPolicy({ ...base, booking: { ...booking, status: "confirmed" }, cancelledBy: "user", cancelledAt: null })).toBe(false)
  })

  it("una devolución rechazada queda fallida con el motivo y se puede reintentar", async () => {
    const s = await setup("falla")
    const booking = await paidBooking(s)
    await changeBookingStatus(s.scoped, { bookingId: booking.id, to: "cancelled" }, panel(s.owner.id), { now: NOW })
    expect(await requestDepositRefund(s.scoped, booking.id)).toBe(true)
    expect(await requestDepositRefund(s.scoped, booking.id)).toBe(false)
    s.mp.deps.api.refundPayment = async () => {
      throw new MercadoPagoError("Payment too old", 400)
    }
    expect(await processPendingRefunds(s.scoped, s.mp.deps, NOW)).toEqual({ refunded: 0, failed: 1 })
    const payment = (await s.scoped.payments.findFirst(eq(schema.payments.bookingId, booking.id)))!
    expect(payment.refundStatus).toBe("failed")
    expect(payment.refundError).toContain("Payment too old")
    expect(await requestDepositRefund(s.scoped, booking.id)).toBe(true)
  })
})

describe("conexión", () => {
  it("una cuenta de Mercado Pago no se conecta a dos negocios", async () => {
    const a = await setup("cuenta-a")
    const b = await seedSalon(db, "cuenta-b")
    const account = (await a.scoped.mpAccounts.findFirst())!
    await expect(
      saveMpConnection(
        b.scoped,
        b.owner.id,
        { tokens: { access_token: "x", refresh_token: "y", expires_in: 100, user_id: account.mpUserId }, displayName: null },
        (v) => v,
        NOW,
      ),
    ).rejects.toBeInstanceOf(PaymentError)
    expect((await a.scoped.business())!.onboardingCompleted).toContain("mercadopago")
    expect(await forPlatform(db).mpAccountByUserId(account.mpUserId)).toMatchObject({ businessId: a.business.id })
  })

  it("renueva el token antes de que venza; si Mercado Pago lo rechaza, avisa una vez", async () => {
    const s = await setup("token")
    await s.scoped.mpAccounts.update(undefined, { expiresAt: new Date(NOW.getTime() + 2 * 86_400_000) })
    let account = (await s.scoped.mpAccounts.findFirst())!
    expect(await accessToken(s.scoped, account, s.mp.deps, NOW)).toBe("nuevo")
    expect(s.mp.refreshed()).toBe(1)
    account = (await s.scoped.mpAccounts.findFirst())!
    expect(account.accessTokenEnc).toBe("enc:nuevo")

    await s.scoped.mpAccounts.update(undefined, { expiresAt: new Date(NOW.getTime() + 86_400_000) })
    account = (await s.scoped.mpAccounts.findFirst())!
    s.mp.failRefresh(new MercadoPagoError("invalid_grant", 400, "invalid_grant"))
    await expect(accessToken(s.scoped, account, s.mp.deps, NOW)).rejects.toBeInstanceOf(PaymentError)
    expect((await s.scoped.mpAccounts.findFirst())!.status).toBe("token_expired")
    expect(await s.scoped.notifications.count(eq(schema.notifications.type, "mercadopago.disconnected"))).toBe(1)
    // Un turno nuevo ya no pide seña.
    expect((await heldBooking(s)).status).toBe("confirmed")
  })

  it("el link de un turno sin seña no se crea", async () => {
    const s = await setup("sin-link")
    const [c] = await s.scoped.customers.insert({ phoneE164: "+59899333444", name: "Sin seña" })
    const booking = await createBooking(
      s.scoped,
      { customerId: c!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: TUE_10, source: "panel" },
      panel(s.owner.id),
      { now: NOW },
    )
    await expect(ensurePaymentLink(s.scoped, booking, s.mp.deps, NOW)).rejects.toBeInstanceOf(PaymentError)
  })
})

describe("lista de espera", () => {
  it("al liberarse un lugar se ofrece en orden; el primero se lo queda y el resto recibe 'ya fue tomado'", async () => {
    const s = await setup("espera")
    await s.scoped.bookingRules.update(undefined, { depositMode: "none", depositValue: 0 })
    const [holder] = await s.scoped.customers.insert({ phoneE164: "+59899500001", name: "Titular" })
    const booking = await createBooking(
      s.scoped,
      { customerId: holder!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: TUE_10, source: "panel" },
      panel(s.owner.id),
      { now: NOW },
    )
    const [first, second] = await s.scoped.customers.insert([
      { phoneE164: "+59899500002", name: "Primera Espera" },
      { phoneE164: "+59899500003", name: "Segunda Espera" },
    ])
    await s.scoped.waitlistEntries.insert({ customerId: first!.id, serviceId: s.corte.id, date: "2026-11-03", createdAt: new Date(NOW.getTime() - 2000) })
    await s.scoped.waitlistEntries.insert({ customerId: second!.id, serviceId: s.corte.id, date: "2026-11-03", createdAt: new Date(NOW.getTime() - 1000) })
    // Esta quiere otro día: no se le ofrece.
    await s.scoped.waitlistEntries.insert({ customerId: s.customer.id, serviceId: s.corte.id, date: "2026-11-04" })

    await changeBookingStatus(s.scoped, { bookingId: booking.id, to: "cancelled" }, panel(s.owner.id), { now: NOW })
    const offers = await scheduled(s.scoped, "waitlist_offer")
    expect(offers.map((o) => o.customerId).sort()).toEqual([first!.id, second!.id].sort())
    const entries = await s.scoped.waitlistEntries.findMany({ where: eq(schema.waitlistEntries.status, "offered") })
    expect(entries).toHaveLength(2)
    expect(entries[0]!.offeredStartsAt).toEqual(TUE_10)

    await sendDueCustomerMessages(s.scoped, s.scheduled, NOW)
    const offerMessage = s.wa.sent.find((m) => m.to === "+59899500002")!
    expect(offerMessage.payload.type).toBe("template")
    const firstEntry = entries.find((e) => e.customerId === first!.id)!
    expect(JSON.stringify(offerMessage.payload)).toContain(waitlistButtonId(firstEntry.id))
    expect(parseWaitlistButton(waitlistButtonId(firstEntry.id))).toEqual({ entryId: firstEntry.id })
    expect(fillTemplate("lugar_liberado", ["Primera", "Corte", "martes 3 de noviembre", "10:00"])).toContain("10:00")

    const firstCustomer = (await s.scoped.customers.findById(first!.id))!
    const won = await acceptWaitlistOffer(s.scoped, firstCustomer, firstEntry.id, "Lo quiero", NOW)
    expect(won.autoReply).toContain("¡Listo!")
    const newBooking = await s.scoped.bookings.findFirst(
      and(eq(schema.bookings.customerId, first!.id), eq(schema.bookings.startsAt, TUE_10)),
    )
    expect(newBooking).toMatchObject({ status: "confirmed", source: "whatsapp" })
    expect(await scheduled(s.scoped, "waitlist_taken")).toHaveLength(1)

    const secondEntry = entries.find((e) => e.customerId === second!.id)!
    const secondCustomer = (await s.scoped.customers.findById(second!.id))!
    const lost = await acceptWaitlistOffer(s.scoped, secondCustomer, secondEntry.id, "Lo quiero", NOW)
    expect(lost.autoReply).toContain("ya lo tomó otra persona")
    expect((await s.scoped.waitlistEntries.findById(secondEntry.id))!.status).toBe("waiting")
  })

  it("con seña, quien toma el lugar recibe el link", async () => {
    const s = await setup("espera-sena")
    const [holder] = await s.scoped.customers.insert({ phoneE164: "+59899600001", name: "Titular" })
    const booking = await createBooking(
      s.scoped,
      { customerId: holder!.id, resourceId: s.ana.id, serviceId: s.corte.id, startsAt: TUE_1030, source: "panel" },
      panel(s.owner.id),
      { now: NOW },
    )
    const [entry] = await s.scoped.waitlistEntries.insert({ customerId: s.customer.id, serviceId: s.corte.id, date: "2026-11-03", fromTime: "10:00", toTime: "11:00" })
    await changeBookingStatus(s.scoped, { bookingId: booking.id, to: "cancelled" }, panel(s.owner.id), { now: NOW })
    const reply = await acceptWaitlistOffer(s.scoped, s.customer, entry!.id, "Lo quiero", NOW)
    expect(reply.autoReply).toContain("link de pago")
    expect(await scheduled(s.scoped, "deposit_request")).toHaveLength(1)
  })
})

describe("aislamiento", () => {
  it("pagos, cuentas de Mercado Pago y lista de espera pasan por el scope del negocio", () => {
    expect(tenantTables.payments).toBe(schema.payments)
    expect(tenantTables.mpAccounts).toBe(schema.mpAccounts)
    expect(tenantTables.waitlistEntries).toBe(schema.waitlistEntries)
  })
})
