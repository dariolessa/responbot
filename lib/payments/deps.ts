import "server-only"

import { publicAppUrl } from "@/lib/app-url"
import { decrypt, encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { mercadoPagoApi, type MpApp } from "@/lib/integrations/mercadopago/api"

import type { PaymentDeps } from "./mercadopago"

/*
 * Piezas reales de Mercado Pago armadas desde las variables de entorno. Los
 * tests no pasan por acá: arman sus PaymentDeps con simulaciones.
 */

export function isMercadoPagoConfigured(): boolean {
  return Boolean(env.MP_CLIENT_ID && env.MP_CLIENT_SECRET)
}

export function mpApp(): MpApp {
  if (!env.MP_CLIENT_ID || !env.MP_CLIENT_SECRET) throw new Error("Faltan MP_CLIENT_ID y MP_CLIENT_SECRET")
  return { clientId: env.MP_CLIENT_ID, clientSecret: env.MP_CLIENT_SECRET }
}

export const MP_CALLBACK_PATH = "/api/integrations/mercadopago/callback"
export const MP_WEBHOOK_PATH = "/api/webhooks/mercadopago"

export function mpRedirectUri(): string {
  return `${publicAppUrl()}${MP_CALLBACK_PATH}`
}

/** null si Mercado Pago no está configurado (los turnos se confirman sin seña). */
export function paymentDeps(): PaymentDeps | null {
  if (!isMercadoPagoConfigured()) return null
  const appUrl = publicAppUrl()
  return {
    api: mercadoPagoApi(mpApp()),
    encrypt: (value) => encrypt(value, env.ENCRYPTION_KEY),
    decrypt: (value) => decrypt(value, env.ENCRYPTION_KEY),
    notificationUrl: `${appUrl}${MP_WEBHOOK_PATH}`,
    backUrl: `${appUrl}/pago`,
  }
}
