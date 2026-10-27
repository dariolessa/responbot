import { notificationEmail } from "@/emails/notification"
import type * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb, type ScopedDb } from "@/lib/db/scoped"
import {
  invoiceSubscriptionId,
  subscriptionPeriodEnd,
  subscriptionPriceId,
  type StripeApi,
  type StripeCheckoutSession,
  type StripeInvoice,
  type StripeSubscription,
} from "@/lib/integrations/stripe/api"
import type { StripeEvent } from "@/lib/integrations/stripe/webhook"
import { formatMoney } from "@/lib/money"
import { notify, type EmailSender } from "@/lib/notifications/dispatch"
import { formatZoned } from "@/lib/time"

import { GRACE_DAYS, isPaidPlan, paidPlanIds, plans, type PaidPlanId } from "./plans"

/*
 * Cobro del SaaS con Stripe Billing (docs/SPEC.md, "Stripe"): Checkout para
 * suscribirse, Customer Portal para cambiar de plan, tarjeta o cancelar, y el
 * webhook que copia el estado de la suscripción al negocio.
 *
 * Del webhook se usa el evento solo para saber qué suscripción mirar: el
 * estado se lee de la API de Stripe, así un evento viejo o repetido no pisa
 * uno nuevo. Las dependencias (API, precios, correo) son inyectables para los
 * tests; lib/billing/deps.ts arma las reales.
 */

export type BillingDeps = {
  api: StripeApi
  /** Precio de Stripe de cada plan (STRIPE_PRICE_*). */
  prices: Record<PaidPlanId, string>
  appUrl: string
  email: EmailSender | null
}

/** Stripe exige que un trial_end esté al menos 48 horas en el futuro. */
const MIN_TRIAL_END_MS = 48 * 3_600_000

export function planForPrice(prices: Record<PaidPlanId, string>, priceId: string | null): PaidPlanId | null {
  if (!priceId) return null
  return paidPlanIds.find((id) => prices[id] === priceId) ?? null
}

/** Cliente de Stripe del negocio; lo crea la primera vez. */
async function ensureCustomer(scoped: ScopedDb, ownerEmail: string | null, deps: BillingDeps): Promise<string> {
  const business = await scoped.business()
  if (!business) throw new Error("billing: no existe el negocio")
  if (business.stripeCustomerId) return business.stripeCustomerId
  const customer = await deps.api.createCustomer({ name: business.name, email: ownerEmail, businessId: business.id })
  await scoped.updateBusiness({ stripeCustomerId: customer.id })
  return customer.id
}

/**
 * URL de Checkout para suscribirse a un plan. Si la prueba todavía tiene más
 * de dos días, Stripe empieza a cobrar recién cuando vence: elegir plan antes
 * no hace perder días de prueba.
 */
export async function startCheckout(
  scoped: ScopedDb,
  input: { plan: PaidPlanId; ownerEmail: string | null },
  deps: BillingDeps,
  now: Date = new Date(),
): Promise<string> {
  const business = await scoped.business()
  if (!business) throw new Error("billing: no existe el negocio")
  const customerId = await ensureCustomer(scoped, input.ownerEmail, deps)
  const keepTrial =
    business.plan === "trial" && business.trialEndsAt && business.trialEndsAt.getTime() - now.getTime() > MIN_TRIAL_END_MS
  const session = await deps.api.createCheckoutSession({
    customerId,
    priceId: deps.prices[input.plan],
    businessId: business.id,
    successUrl: `${deps.appUrl}/app/facturacion?estado=suscripto`,
    cancelUrl: `${deps.appUrl}/app/facturacion`,
    trialEnd: keepTrial ? business.trialEndsAt : null,
  })
  if (!session.url) throw new Error("billing: Stripe no devolvió la URL de Checkout")
  return session.url
}

/** URL del Customer Portal (cambiar de plan con prorrateo, tarjeta, facturas o cancelar). */
export async function openPortal(scoped: ScopedDb, deps: BillingDeps): Promise<string | null> {
  const business = await scoped.business()
  if (!business?.stripeCustomerId) return null
  const session = await deps.api.createPortalSession({
    customerId: business.stripeCustomerId,
    returnUrl: `${deps.appUrl}/app/facturacion`,
  })
  return session.url
}

/** Copia la suscripción al negocio. Devuelve el plan que quedó. */
export async function applySubscription(
  scoped: ScopedDb,
  subscription: StripeSubscription,
  deps: Pick<BillingDeps, "prices">,
): Promise<schema.Business["plan"]> {
  const business = await scoped.business()
  if (!business) throw new Error("billing: no existe el negocio")
  // Una suscripción vieja (por ejemplo cancelada y reemplazada) no pisa la vigente.
  if (business.stripeSubscriptionId && business.stripeSubscriptionId !== subscription.id) {
    const ended = ["canceled", "incomplete_expired"].includes(subscription.status)
    if (ended) return business.plan
  }
  const plan = planForPrice(deps.prices, subscriptionPriceId(subscription)) ?? (isPaidPlan(business.plan) ? business.plan : "basic")
  const paid = ["active", "trialing"].includes(subscription.status)
  await scoped.updateBusiness({
    plan,
    stripeCustomerId: business.stripeCustomerId ?? subscription.customer,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentFailedAt: paid ? null : business.paymentFailedAt,
  })
  if (plan !== business.plan || subscription.status !== business.subscriptionStatus) {
    await scoped.auditLogs.insert({
      actorId: null,
      action: "billing.subscription",
      targetType: "business",
      targetId: business.id,
      metadata: {
        subscriptionId: subscription.id,
        from: { plan: business.plan, status: business.subscriptionStatus },
        to: { plan, status: subscription.status },
      },
    })
  }
  return plan
}

async function ownerEmails(scoped: ScopedDb): Promise<string[]> {
  return (await scoped.members())
    .filter((m) => m.active && m.role === "owner" && m.email && !m.emailBouncedAt)
    .map((m) => m.email!)
}

/** Primer cobro fallido de la racha: marca el inicio de la gracia y avisa al dueño (panel y correo). */
export async function recordPaymentFailed(scoped: ScopedDb, now: Date): Promise<boolean> {
  const business = await scoped.business()
  if (!business || business.paymentFailedAt) return false
  await scoped.updateBusiness({ paymentFailedAt: now })
  const graceEnds = new Date(now.getTime() + GRACE_DAYS * 86_400_000)
  await notify(scoped, {
    type: "billing.payment_failed",
    payload: { graceEndsOn: formatZoned(graceEnds, business.timezone, "EEEE d 'de' MMMM") },
    now,
  })
  return true
}

/** Pago aprobado: se cierra la racha de fallos y se manda el recibo (una vez por factura). */
export async function recordInvoicePaid(
  scoped: ScopedDb,
  invoice: StripeInvoice,
  deps: Pick<BillingDeps, "email" | "appUrl">,
): Promise<boolean> {
  const business = await scoped.business()
  if (!business) return false
  if (business.paymentFailedAt) await scoped.updateBusiness({ paymentFailedAt: null })
  // Las facturas en cero (el inicio de una prueba en Stripe) no llevan recibo.
  if (invoice.amount_paid <= 0 || business.lastReceiptInvoiceId === invoice.id) return false
  await scoped.updateBusiness({ lastReceiptInvoiceId: invoice.id })
  if (!deps.email) return false
  const amount = formatMoney(invoice.amount_paid, invoice.currency.toUpperCase())
  const plan = isPaidPlan(business.plan) ? plans[business.plan].name : "tu plan"
  const rendered = await notificationEmail(`Recibo de tu suscripción · ${business.name}`, {
    businessName: business.name,
    title: "Recibimos tu pago",
    body: `Gracias. Cobramos ${amount} del plan ${plan}.`,
    button: { label: "Ver la factura", url: invoice.hosted_invoice_url ?? `${deps.appUrl}/app/facturacion` },
    preferencesUrl: `${deps.appUrl}/app/notificaciones`,
  })
  for (const to of await ownerEmails(scoped)) {
    try {
      await deps.email.send({ to, ...rendered })
    } catch (error) {
      console.error("[facturación] no se pudo mandar el recibo", business.id, error)
    }
  }
  return true
}

export const handledEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
] as const

/** De qué negocio es un evento: metadata, referencia de Checkout o cliente de Stripe. */
async function businessFor(database: AnyDb, object: Record<string, unknown>): Promise<string | null> {
  const metadata = (object.metadata ?? {}) as Record<string, string>
  const candidates = [metadata.business_id, object.client_reference_id].filter(
    (v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
  )
  for (const id of candidates) {
    if (await forBusiness(database, id).business()) return id
  }
  const customer = typeof object.customer === "string" ? object.customer : null
  if (!customer) return null
  const business = await forPlatform(database).businessByStripeCustomerId(customer)
  return business?.id ?? null
}

export type StripeEventResult = { handled: boolean; businessId?: string; detail?: string }

export async function handleStripeEvent(
  database: AnyDb,
  event: StripeEvent,
  deps: BillingDeps,
  now: Date = new Date(),
): Promise<StripeEventResult> {
  if (!(handledEvents as readonly string[]).includes(event.type)) return { handled: false }
  const object = event.data.object
  const businessId = await businessFor(database, object)
  if (!businessId) return { handled: false, detail: "Sin negocio" }
  const scoped = forBusiness(database, businessId)

  switch (event.type) {
    case "checkout.session.completed": {
      const session = object as unknown as StripeCheckoutSession
      const business = await scoped.business()
      if (session.customer && !business?.stripeCustomerId) await scoped.updateBusiness({ stripeCustomerId: session.customer })
      if (session.subscription) {
        await applySubscription(scoped, await deps.api.getSubscription(session.subscription), deps)
      }
      return { handled: true, businessId }
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const id = String(object.id)
      // Una suscripción borrada sigue existiendo en la API con status "canceled".
      await applySubscription(scoped, await deps.api.getSubscription(id), deps)
      return { handled: true, businessId }
    }
    case "invoice.payment_failed": {
      const invoice = object as unknown as StripeInvoice
      const business = await scoped.business()
      const subscriptionId = invoiceSubscriptionId(invoice)
      if (subscriptionId && subscriptionId !== business?.stripeSubscriptionId) {
        await applySubscription(scoped, await deps.api.getSubscription(subscriptionId), deps)
      }
      await recordPaymentFailed(scoped, now)
      return { handled: true, businessId }
    }
    case "invoice.paid": {
      await recordInvoicePaid(scoped, object as unknown as StripeInvoice, deps)
      return { handled: true, businessId }
    }
  }
  return { handled: false }
}

/** ¿Tiene suscripción que se administra en el portal? */
export function hasSubscription(business: Pick<schema.Business, "stripeSubscriptionId" | "subscriptionStatus">): boolean {
  return Boolean(business.stripeSubscriptionId && business.subscriptionStatus && business.subscriptionStatus !== "canceled")
}
