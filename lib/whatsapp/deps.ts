import "server-only"

import { decrypt, encrypt } from "@/lib/crypto"
import type * as schema from "@/lib/db/schema"
import { env } from "@/lib/env"
import { anthropicDescriber, anthropicModel, isAnthropicConfigured } from "@/lib/integrations/anthropic/client"
import { configuredTranscriber } from "@/lib/integrations/transcriber"
import { cloudApi, type WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import type { GraphOptions } from "@/lib/integrations/whatsapp/graph"
import type { MetaApp } from "@/lib/integrations/whatsapp/signup"

import type { WhatsAppDeps } from "./inbound"

/*
 * Piezas reales de WhatsApp armadas desde las variables de entorno. Los tests
 * no pasan por acá: arman sus WhatsAppDeps con simulaciones.
 */

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_CONFIG_ID && env.WHATSAPP_VERIFY_TOKEN)
}

export function metaApp(): MetaApp {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("Faltan META_APP_ID y META_APP_SECRET")
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET }
}

export function graphOptions(token?: string): GraphOptions {
  return { version: env.WHATSAPP_API_VERSION, token }
}

export const encryptToken = (token: string) => encrypt(token, env.ENCRYPTION_KEY)

export function accountToken(account: Pick<schema.WhatsAppAccount, "accessTokenEnc">): string {
  return decrypt(account.accessTokenEnc, env.ENCRYPTION_KEY)
}

export function apiFor(account: schema.WhatsAppAccount): WhatsAppApi {
  return cloudApi(
    { phoneNumberId: account.phoneNumberId, token: accountToken(account) },
    { version: env.WHATSAPP_API_VERSION },
  )
}

export function whatsappDeps(): WhatsAppDeps {
  const ai = isAnthropicConfigured()
  return {
    api: apiFor,
    model: ai ? anthropicModel() : null,
    describer: ai ? anthropicDescriber() : null,
    transcriber: configuredTranscriber(),
  }
}
