/*
 * API oficial de Stripe (https://api.stripe.com/v1) para el cobro del SaaS:
 * clientes, Checkout en modo suscripción, Customer Portal y lectura de la
 * suscripción. Stripe recibe formularios (application/x-www-form-urlencoded)
 * con claves anidadas como `line_items[0][price]`. `fetch` es inyectable para
 * simular a Stripe en tests.
 *
 * No se fija Stripe-Version: rige la versión de la cuenta. Los campos que
 * cambiaron de lugar entre versiones (el fin del período, la suscripción de
 * una factura) se leen de los dos lados.
 */

export const STRIPE_API = "https://api.stripe.com/v1"

export type StripeOptions = { fetch?: typeof fetch }

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "StripeError"
  }
}

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue }

/** { line_items: [{ price: "p" }] } → "line_items[0][price]=p". Los null/undefined no se mandan. */
export function encodeForm(data: Record<string, FormValue>): string {
  const pairs: string[] = []
  const walk = (prefix: string, value: FormValue) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v))
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v)
    else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
  }
  for (const [key, value] of Object.entries(data)) walk(key, value)
  return pairs.join("&")
}

async function stripeRequest<T>(
  secretKey: string,
  options: StripeOptions,
  method: "GET" | "POST",
  path: string,
  init: { body?: Record<string, FormValue>; idempotencyKey?: string } = {},
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` }
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded"
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey
  const response = await doFetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: init.body ? encodeForm(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // No es JSON: se informa con el estado HTTP.
  }
  if (!response.ok) {
    const error = ((json ?? {}) as { error?: { message?: string; code?: string } }).error
    throw new StripeError(error?.message ?? `Stripe respondió ${response.status}`, response.status, error?.code)
  }
  return json as T
}

// ---------------------------------------------------------------------------
// Tipos (solo lo que se usa)
// ---------------------------------------------------------------------------

export type StripeSubscription = {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  current_period_end?: number
  metadata?: Record<string, string>
  items: { data: { price: { id: string }; current_period_end?: number }[] }
}

export type StripeInvoice = {
  id: string
  customer: string
  subscription?: string | null
  parent?: { subscription_details?: { subscription?: string | null } | null } | null
  amount_paid: number
  amount_due: number
  currency: string
  hosted_invoice_url?: string | null
  billing_reason?: string | null
}

export type StripeCheckoutSession = {
  id: string
  url: string | null
  customer: string | null
  subscription: string | null
  client_reference_id: string | null
  metadata?: Record<string, string>
}

/** Fin del período pagado, esté en la suscripción (versiones viejas) o en el ítem (nuevas). */
export function subscriptionPeriodEnd(subscription: StripeSubscription): Date | null {
  const seconds = subscription.items.data[0]?.current_period_end ?? subscription.current_period_end
  return seconds ? new Date(seconds * 1000) : null
}

export function subscriptionPriceId(subscription: StripeSubscription): string | null {
  return subscription.items.data[0]?.price.id ?? null
}

export function invoiceSubscriptionId(invoice: StripeInvoice): string | null {
  return invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

export type CheckoutInput = {
  customerId: string
  priceId: string
  businessId: string
  successUrl: string
  cancelUrl: string
  /** Si le quedan días de prueba, la suscripción empieza a cobrar recién ese día. */
  trialEnd?: Date | null
}

export type StripeApi = {
  createCustomer(input: { name: string; email: string | null; businessId: string }): Promise<{ id: string }>
  createCheckoutSession(input: CheckoutInput): Promise<StripeCheckoutSession>
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>
  getSubscription(id: string): Promise<StripeSubscription>
}

export function stripeApi(secretKey: string, options: StripeOptions = {}): StripeApi {
  return {
    createCustomer: (input) =>
      stripeRequest(secretKey, options, "POST", "/customers", {
        body: { name: input.name, email: input.email, metadata: { business_id: input.businessId } },
        // Dos clics seguidos en "Elegir plan" no crean dos clientes.
        idempotencyKey: `customer-${input.businessId}`,
      }),

    createCheckoutSession: (input) =>
      stripeRequest(secretKey, options, "POST", "/checkout/sessions", {
        body: {
          mode: "subscription",
          customer: input.customerId,
          client_reference_id: input.businessId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          allow_promotion_codes: true,
          locale: "es-419",
          metadata: { business_id: input.businessId },
          subscription_data: {
            metadata: { business_id: input.businessId },
            trial_end: input.trialEnd ? Math.floor(input.trialEnd.getTime() / 1000) : null,
          },
        },
      }),

    createPortalSession: (input) =>
      stripeRequest(secretKey, options, "POST", "/billing_portal/sessions", {
        body: { customer: input.customerId, return_url: input.returnUrl, locale: "es-419" },
      }),

    getSubscription: (id) => stripeRequest(secretKey, options, "GET", `/subscriptions/${encodeURIComponent(id)}`),
  }
}
