import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { featureFailure, readOnlyFailure, staffLimitFailure } from "@/lib/billing/access"
import { checkUsageAlerts, sendTrialEndingEmail } from "@/lib/billing/lifecycle"
import { cheapestPlanForStaff, cheapestPlanWith, plans } from "@/lib/billing/plans"
import { billingState, hasFeature, type BillingFields } from "@/lib/billing/state"
import { handleStripeEvent, planForPrice, recordPaymentFailed, startCheckout, type BillingDeps } from "@/lib/billing/stripe"
import { depositForBooking } from "@/lib/booking/create"
import * as schema from "@/lib/db/schema"
import { forPlatform } from "@/lib/db/scoped"
import {
  encodeForm,
  invoiceSubscriptionId,
  subscriptionPeriodEnd,
  type CheckoutInput,
  type StripeApi,
  type StripeSubscription,
} from "@/lib/integrations/stripe/api"
import { signStripePayload, verifyStripeSignature } from "@/lib/integrations/stripe/webhook"
import type { EmailSender } from "@/lib/notifications/dispatch"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon } from "../helpers/bot"

/*
 * Fase 6: planes, límites y cobro del SaaS con Stripe, sin servicios externos.
 * Stripe y el correo son simulaciones que anotan lo que se pidió.
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

const base: BillingFields = { plan: "trial", trialEndsAt: null, subscriptionStatus: null, paymentFailedAt: null }

describe("estado de la cuenta", () => {
  it("prueba vigente: todo habilitado, con los días que quedan", () => {
    const state = billingState({ ...base, trialEndsAt: new Date(NOW.getTime() + 3.5 * DAY) }, NOW)
    expect(state).toMatchObject({ status: "trialing", canBook: true, readOnly: false, trialDaysLeft: 3 })
    expect(hasFeature(state, "reactivation")).toBe(true)
    expect(state.plan.monthlyConversations).toBe(plans.pro.monthlyConversations)
  })

  it("prueba vencida sin plan: no reserva y el panel queda en solo lectura", () => {
    const state = billingState({ ...base, trialEndsAt: new Date(NOW.getTime() - 1000) }, NOW)
    expect(state).toMatchObject({ status: "trial_expired", canBook: false, readOnly: true })
  })

  it("plan pago activo, con sus funciones", () => {
    const state = billingState({ ...base, plan: "basic", subscriptionStatus: "active" }, NOW)
    expect(state).toMatchObject({ status: "active", canBook: true, readOnly: false })
    expect(hasFeature(state, "deposits")).toBe(false)
    expect(hasFeature(billingState({ ...base, plan: "pro", subscriptionStatus: "active" }, NOW), "deposits")).toBe(true)
  })

  it("pago fallido: 7 días de gracia y después solo lectura", () => {
    const failed = { ...base, plan: "pro" as const, subscriptionStatus: "past_due" }
    const inGrace = billingState({ ...failed, paymentFailedAt: new Date(NOW.getTime() - 6 * DAY) }, NOW)
    expect(inGrace).toMatchObject({ status: "past_due", canBook: true, readOnly: false })
    const after = billingState({ ...failed, paymentFailedAt: new Date(NOW.getTime() - 8 * DAY) }, NOW)
    expect(after).toMatchObject({ status: "suspended", canBook: false, readOnly: true })
  })

  it("suscripción cancelada: si queda prueba sigue en prueba; si no, sin plan", () => {
    const canceled = { ...base, plan: "pro" as const, subscriptionStatus: "canceled" }
    expect(billingState({ ...canceled, trialEndsAt: new Date(NOW.getTime() + 5 * DAY) }, NOW).status).toBe("trialing")
    expect(billingState({ ...canceled, trialEndsAt: new Date(NOW.getTime() - DAY) }, NOW)).toMatchObject({
      status: "canceled",
      readOnly: true,
    })
  })

  it("límite de profesionales y plan sugerido", () => {
    const basic = billingState({ ...base, plan: "basic", subscriptionStatus: "active" }, NOW)
    expect(staffLimitFailure(basic, 1)).toBeNull()
    expect(staffLimitFailure(basic, 2)?.error).toContain("plan Pro")
    expect(staffLimitFailure(billingState({ ...base, plan: "pro", subscriptionStatus: "active" }, NOW), 6)?.error).toContain(
      "plan Equipo",
    )
    expect(cheapestPlanForStaff(1).id).toBe("basic")
    expect(cheapestPlanWith("stats").id).toBe("pro")
    expect(cheapestPlanWith("reactivation").id).toBe("team")
    expect(featureFailure("waitlist").error).toContain("plan Pro")
  })
})

describe("API y firma de Stripe", () => {
  it("arma formularios con claves anidadas", () => {
    expect(
      encodeForm({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { a: "b c" }, skip: null }),
    ).toBe("mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Ba%5D=b%20c")
  })

  it("lee el fin del período y la suscripción de una factura en las dos versiones de la API", () => {
    const sub = { items: { data: [{ price: { id: "p" }, current_period_end: 1_800_000_000 }] } } as StripeSubscription
    expect(subscriptionPeriodEnd(sub)?.getTime()).toBe(1_800_000_000_000)
    expect(subscriptionPeriodEnd({ items: { data: [{ price: { id: "p" } }] }, current_period_end: 1 } as StripeSubscription)?.getTime()).toBe(1000)
    const invoice = { id: "in", customer: "c", amount_paid: 0, amount_due: 0, currency: "usd" }
    expect(invoiceSubscriptionId({ ...invoice, subscription: "sub_old" })).toBe("sub_old")
    expect(invoiceSubscriptionId({ ...invoice, parent: { subscription_details: { subscription: "sub_new" } } })).toBe("sub_new")
  })

  it("verifica la firma Stripe-Signature y rechaza firmas viejas o ajenas", () => {
    const payload = JSON.stringify({ id: "evt_1" })
    const header = signStripePayload(payload, "whsec_test", NOW)
    expect(verifyStripeSignature({ payload, header, secret: "whsec_test", now: NOW })).toBe(true)
    expect(verifyStripeSignature({ payload: payload + " ", header, secret: "whsec_test", now: NOW })).toBe(false)
    expect(verifyStripeSignature({ payload, header, secret: "otro", now: NOW })).toBe(false)
    expect(verifyStripeSignature({ payload, header, secret: "whsec_test", now: new Date(NOW.getTime() + 10 * 60_000) })).toBe(false)
    expect(verifyStripeSignature({ payload, header: null, secret: "whsec_test", now: NOW })).toBe(false)
  })
})

const prices = { basic: "price_basic", pro: "price_pro", team: "price_team" }

function fakeStripe() {
  const subscriptions: Record<string, StripeSubscription> = {}
  const checkouts: CheckoutInput[] = []
  const emails: { to: string; subject: string }[] = []
  let customers = 0
  const api: StripeApi = {
    async createCustomer() {
      return { id: `cus_${++customers}` }
    },
    async createCheckoutSession(input) {
      checkouts.push(input)
      return { id: "cs_1", url: "https://checkout.stripe.test/cs_1", customer: input.customerId, subscription: null, client_reference_id: input.businessId }
    },
    async createPortalSession() {
      return { url: "https://billing.stripe.test/p" }
    },
    async getSubscription(id) {
      const sub = subscriptions[id]
      if (!sub) throw new Error("no existe")
      return sub
    },
  }
  const email: EmailSender = {
    async send(input) {
      emails.push({ to: input.to, subject: input.subject })
    },
  }
  const deps: BillingDeps = { api, prices, appUrl: "https://app.responbot.test", email }
  const setSubscription = (id: string, customer: string, price: string, status: string, extra: Partial<StripeSubscription> = {}) => {
    subscriptions[id] = {
      id,
      customer,
      status,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: price }, current_period_end: Math.floor((NOW.getTime() + 30 * DAY) / 1000) }] },
      ...extra,
    }
  }
  return { deps, checkouts, emails, setSubscription, customers: () => customers }
}

const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${Math.random()}`, type, data: { object } })

describe("suscripción con Stripe", () => {
  it("Checkout crea el cliente una vez y respeta los días de prueba que quedan", async () => {
    const salon = await seedSalon(db, "stripe-checkout")
    const stripe = fakeStripe()
    const url = await startCheckout(salon.scoped, { plan: "pro", ownerEmail: salon.owner.email }, stripe.deps, NOW)
    expect(url).toBe("https://checkout.stripe.test/cs_1")
    expect(stripe.checkouts[0]).toMatchObject({ priceId: "price_pro", businessId: salon.business.id, customerId: "cus_1" })
    // La prueba de seedSalon vence el 31 de diciembre: Stripe cobra recién ese día.
    expect(stripe.checkouts[0]!.trialEnd?.toISOString()).toBe("2026-12-31T00:00:00.000Z")

    await startCheckout(salon.scoped, { plan: "basic", ownerEmail: salon.owner.email }, stripe.deps, NOW)
    expect(stripe.customers()).toBe(1)

    // Con menos de 48 horas de prueba, se cobra enseguida.
    await salon.scoped.updateBusiness({ trialEndsAt: new Date(NOW.getTime() + DAY) })
    await startCheckout(salon.scoped, { plan: "basic", ownerEmail: null }, stripe.deps, NOW)
    expect(stripe.checkouts[2]!.trialEnd).toBeNull()

    // Un piloto que se suscribe empieza a pagar cuando termina el piloto (Fase 7).
    const pilotEndsAt = new Date(NOW.getTime() + 40 * DAY)
    await salon.scoped.updateBusiness({ pilotEndsAt })
    await startCheckout(salon.scoped, { plan: "basic", ownerEmail: null }, stripe.deps, NOW)
    expect(stripe.checkouts[3]!.trialEnd).toEqual(pilotEndsAt)
  })

  it("el webhook copia la suscripción, el pago fallido abre la gracia y el pago aprobado manda un recibo", async () => {
    const salon = await seedSalon(db, "stripe-webhook")
    const stripe = fakeStripe()
    await salon.scoped.updateBusiness({ stripeCustomerId: "cus_wh" })
    stripe.setSubscription("sub_1", "cus_wh", "price_pro", "active")

    const completed = await handleStripeEvent(
      db,
      event("checkout.session.completed", {
        id: "cs_1",
        customer: "cus_wh",
        subscription: "sub_1",
        client_reference_id: salon.business.id,
        metadata: { business_id: salon.business.id },
      }),
      stripe.deps,
      NOW,
    )
    expect(completed).toMatchObject({ handled: true, businessId: salon.business.id })
    let business = (await salon.scoped.business())!
    expect(business).toMatchObject({ plan: "pro", subscriptionStatus: "active", stripeSubscriptionId: "sub_1" })
    expect(billingState(business, NOW).status).toBe("active")
    const audits = await salon.scoped.auditLogs.findMany({ where: eq(schema.auditLogs.action, "billing.subscription") })
    expect(audits).toHaveLength(1)

    // Cambio de plan desde el portal: el evento solo dice qué suscripción mirar.
    stripe.setSubscription("sub_1", "cus_wh", "price_team", "active")
    await handleStripeEvent(db, event("customer.subscription.updated", { id: "sub_1", customer: "cus_wh" }), stripe.deps, NOW)
    expect((await salon.scoped.business())!.plan).toBe("team")

    // Cobro fallido: un solo aviso aunque Stripe reintente.
    stripe.setSubscription("sub_1", "cus_wh", "price_team", "past_due")
    await handleStripeEvent(db, event("customer.subscription.updated", { id: "sub_1", customer: "cus_wh" }), stripe.deps, NOW)
    const invoice = { id: "in_1", customer: "cus_wh", amount_paid: 0, amount_due: 7900, currency: "usd", subscription: "sub_1" }
    await handleStripeEvent(db, event("invoice.payment_failed", invoice), stripe.deps, NOW)
    await handleStripeEvent(db, event("invoice.payment_failed", invoice), stripe.deps, new Date(NOW.getTime() + DAY))
    business = (await salon.scoped.business())!
    expect(business.paymentFailedAt?.getTime()).toBe(NOW.getTime())
    expect(billingState(business, NOW).status).toBe("past_due")
    const failedNotices = await salon.scoped.notifications.findMany({ where: eq(schema.notifications.type, "billing.payment_failed") })
    expect(failedNotices).toHaveLength(1)
    expect(failedNotices[0]!.channels).toEqual(["in_app", "email"])

    // Pago aprobado: vuelve a estar al día y llega un recibo (una vez por factura).
    stripe.setSubscription("sub_1", "cus_wh", "price_team", "active")
    await handleStripeEvent(db, event("customer.subscription.updated", { id: "sub_1", customer: "cus_wh" }), stripe.deps, NOW)
    const paid = { ...invoice, amount_paid: 7900, hosted_invoice_url: "https://invoice.stripe.test/in_1" }
    await handleStripeEvent(db, event("invoice.paid", paid), stripe.deps, NOW)
    await handleStripeEvent(db, event("invoice.paid", paid), stripe.deps, NOW)
    business = (await salon.scoped.business())!
    expect(business.paymentFailedAt).toBeNull()
    expect(stripe.emails.filter((e) => e.subject.startsWith("Recibo"))).toHaveLength(1)

    // Cancelada y vencida la prueba: sin plan.
    stripe.setSubscription("sub_1", "cus_wh", "price_team", "canceled")
    await salon.scoped.updateBusiness({ trialEndsAt: new Date(NOW.getTime() - DAY) })
    await handleStripeEvent(db, event("customer.subscription.deleted", { id: "sub_1", customer: "cus_wh" }), stripe.deps, NOW)
    business = (await salon.scoped.business())!
    expect(billingState(business, NOW)).toMatchObject({ status: "canceled", readOnly: true, canBook: false })
    expect((await readOnlyFailure(salon.scoped, NOW))?.error).toContain("Tu suscripción terminó")
  })

  it("ignora eventos de otros negocios o tipos que no se usan", async () => {
    const stripe = fakeStripe()
    expect(await handleStripeEvent(db, event("invoice.paid", { id: "x", customer: "cus_nadie" }), stripe.deps, NOW)).toMatchObject({
      handled: false,
    })
    expect(await handleStripeEvent(db, event("charge.refunded", {}), stripe.deps, NOW)).toEqual({ handled: false })
    expect(await forPlatform(db).businessByStripeCustomerId("cus_nadie")).toBeUndefined()
    expect(planForPrice(prices, "price_team")).toBe("team")
    expect(planForPrice(prices, "otro")).toBeNull()
  })
})

describe("límites en la práctica", () => {
  it("el plan Básico no pide seña aunque Mercado Pago esté conectado", async () => {
    const salon = await seedSalon(db, "billing-deposit")
    await salon.scoped.bookingRules.update(undefined, { depositMode: "fixed", depositValue: 20000 })
    await salon.scoped.mpAccounts.insert({
      mpUserId: "mp-billing-1",
      accessTokenEnc: "x",
      refreshTokenEnc: "y",
      expiresAt: new Date(NOW.getTime() + 100 * DAY),
    })
    const [customer] = await salon.scoped.customers.insert({ phoneE164: "+59899111222", name: "Ana" })
    const input = { price: 60000, depositOverride: null, customer: customer! }
    expect((await depositForBooking(salon.scoped, input, NOW)).amount).toBe(20000)
    await salon.scoped.updateBusiness({ plan: "basic", subscriptionStatus: "active" })
    expect((await depositForBooking(salon.scoped, input, NOW)).amount).toBe(0)
  })

  it("avisa al dueño al 80 % y al 100 % del uso, una vez por mes", async () => {
    const salon = await seedSalon(db, "billing-usage")
    await salon.scoped.updateBusiness({ plan: "basic", subscriptionStatus: "active" })
    const [counter] = await salon.scoped.usageCounters.insert({ period: "2026-11", conversations: 250 })
    expect(await checkUsageAlerts(salon.scoped, NOW)).toEqual(["conversations_80"])
    expect(await checkUsageAlerts(salon.scoped, NOW)).toEqual([])
    await salon.scoped.usageCounters.update(eq(schema.usageCounters.id, counter!.id), { conversations: 310 })
    expect(await checkUsageAlerts(salon.scoped, NOW)).toEqual(["conversations_100"])
    const notices = await salon.scoped.notifications.findMany({ where: eq(schema.notifications.type, "billing.usage") })
    expect(notices).toHaveLength(2)
    expect(notices.map((n) => (n.payload as { percent: number }).percent).sort()).toEqual([100, 80])
  })

  it("correo de fin de prueba 3 días antes y el último día, solo al dueño", async () => {
    const salon = await seedSalon(db, "billing-trial")
    const stripe = fakeStripe()
    await salon.scoped.updateBusiness({ trialEndsAt: new Date(NOW.getTime() + 3.2 * DAY) })
    expect(await sendTrialEndingEmail(salon.scoped, NOW, stripe.deps.email, "https://app.test")).toBe("trial_3d")
    expect(await sendTrialEndingEmail(salon.scoped, NOW, stripe.deps.email, "https://app.test")).toBeNull()
    expect(await sendTrialEndingEmail(salon.scoped, new Date(NOW.getTime() + 3 * DAY), stripe.deps.email, "https://app.test")).toBe(
      "trial_end",
    )
    expect(stripe.emails.map((e) => e.to)).toEqual([salon.owner.email, salon.owner.email])
    expect(stripe.emails[1]!.subject).toContain("termina hoy")
    // Con plan pago no hay correo.
    const other = await seedSalon(db, "billing-trial-paid")
    await other.scoped.updateBusiness({ plan: "pro", subscriptionStatus: "trialing", trialEndsAt: new Date(NOW.getTime() + 2 * DAY) })
    expect(await sendTrialEndingEmail(other.scoped, NOW, stripe.deps.email, "https://app.test")).toBeNull()
  })

  it("los avisos de facturación son solo para el dueño", async () => {
    const salon = await seedSalon(db, "billing-owner-only")
    const [admin] = await db.insert(schema.users).values({ email: "admin-billing@example.com" }).returning()
    await salon.scoped.memberships.insert({ userId: admin!.id, role: "admin" })
    await salon.scoped.updateBusiness({ plan: "pro", subscriptionStatus: "past_due" })
    await recordPaymentFailed(salon.scoped, NOW)
    const rows = await salon.scoped.notifications.findMany({
      where: eq(schema.notifications.type, "billing.payment_failed"),
    })
    expect(rows.map((r) => r.userId)).toEqual([salon.owner.id])
  })
})
