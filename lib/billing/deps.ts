import "server-only"

import { publicAppUrl } from "@/lib/app-url"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/integrations/resend/client"
import { stripeApi } from "@/lib/integrations/stripe/api"

import type { BillingDeps } from "./stripe"

/*
 * Piezas reales de Stripe armadas desde las variables de entorno. Los tests no
 * pasan por acá: arman sus BillingDeps con simulaciones.
 */

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_BASIC && env.STRIPE_PRICE_PRO && env.STRIPE_PRICE_TEAM)
}

/** null si Stripe no está configurado (Facturación muestra los planes como "Muy pronto"). */
export function billingDeps(): BillingDeps | null {
  if (!isStripeConfigured()) return null
  return {
    api: stripeApi(env.STRIPE_SECRET_KEY!),
    prices: { basic: env.STRIPE_PRICE_BASIC!, pro: env.STRIPE_PRICE_PRO!, team: env.STRIPE_PRICE_TEAM! },
    appUrl: publicAppUrl(),
    email: { send: (input) => sendEmail(input) },
  }
}
