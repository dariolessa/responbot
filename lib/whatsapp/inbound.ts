import { eq } from "drizzle-orm"

import { handleIncomingMessage, type HandleMessageInput } from "@/lib/bot/engine"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb, type ScopedDb } from "@/lib/db/scoped"
import type { BotModel, ImageDescriber } from "@/lib/integrations/anthropic/types"
import { audioDurationSeconds } from "@/lib/integrations/transcriber/duration"
import { MAX_AUDIO_SECONDS, type Transcriber } from "@/lib/integrations/transcriber/types"
import type { WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import type { WebhookEvent } from "@/lib/integrations/whatsapp/webhook"

import {
  AUDIO_FAILED_REPLY,
  AUDIO_TOO_LONG_REPLY,
  AUDIO_UNAVAILABLE_REPLY,
  choiceText,
  OPT_IN_REPLY,
  OPT_OUT_REPLY,
  optOutCommand,
  UNSUPPORTED_REPLY,
  unsupportedText,
} from "./messages"
import { deliverMessage, failedStatusError, shouldApplyStatus } from "./outbound"

/*
 * Procesamiento de los eventos del webhook de WhatsApp (docs/SPEC.md,
 * "Procesamiento de cada mensaje"), ya con la firma verificada:
 *
 * - El phone_number_id identifica al negocio; desde ahí todo pasa por su scope.
 * - El cliente se busca por teléfono (se crea si es nuevo) con su conversación.
 * - Audios: se descargan, se transcriben y se tratan como texto. Imágenes: se
 *   describen con el modelo. El archivo no se guarda.
 * - El motor del bot responde y cada respuesta sale por WhatsApp apenas está.
 * - Los estados (enviado, entregado, leído, fallido) actualizan los mensajes.
 */

export type WhatsAppDeps = {
  /** Cliente de Cloud API para la cuenta, con su token ya descifrado. */
  api(account: schema.WhatsAppAccount): WhatsAppApi
  /** null si falta ANTHROPIC_API_KEY: los mensajes se guardan y quedan para una persona. */
  model: BotModel | null
  transcriber: Transcriber | null
  describer: ImageDescriber | null
  now?: () => Date
}

const DISCONNECT_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_DELETED"])

export async function processWebhookEvents(db: AnyDb, events: WebhookEvent[], deps: WhatsAppDeps) {
  const platform = forPlatform(db)
  for (const event of events) {
    try {
      if (event.kind === "account") {
        if (!DISCONNECT_EVENTS.has(event.event)) continue
        for (const account of await platform.whatsAppAccountsByWabaId(event.wabaId)) {
          await forBusiness(db, account.businessId).whatsappAccounts.update(undefined, { status: "disconnected" })
        }
        continue
      }

      const account = await platform.whatsAppAccountByPhoneNumberId(event.phoneNumberId)
      if (!account) {
        console.warn("[whatsapp] evento para un número que no está conectado", event.phoneNumberId)
        continue
      }
      const scoped = forBusiness(db, account.businessId)
      if (event.kind === "status") await applyStatus(scoped, event)
      else await handleInbound(scoped, account, event, deps)
    } catch (error) {
      // Un evento que falla no frena a los demás; Meta no reintenta porque ya respondimos 200.
      console.error("[whatsapp] falló un evento", event.kind, error)
    }
  }
}

async function applyStatus(scoped: ScopedDb, event: Extract<WebhookEvent, { kind: "status" }>) {
  const message = await scoped.messages.findFirst(eq(schema.messages.wamid, event.wamid))
  if (!message || !shouldApplyStatus(message.status, event.status)) return
  await scoped.messages.update(eq(schema.messages.id, message.id), {
    status: event.status,
    ...(event.status === "failed" ? { error: failedStatusError(event.errorCode) } : {}),
  })
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; cause?: unknown }
    if (e.code === "23505") return true
    current = e.cause
  }
  return false
}

/** Cliente por teléfono y su conversación; los crea si es la primera vez que escribe. */
export async function findOrCreateConversation(scoped: ScopedDb, phoneE164: string, profileName: string | null) {
  let customer = await scoped.customers.findFirst(eq(schema.customers.phoneE164, phoneE164))
  if (!customer) {
    try {
      // El nombre de perfil de WhatsApp es un punto de partida; el bot lo corrige si el cliente dice otro.
      ;[customer] = await scoped.customers.insert({ phoneE164, name: profileName?.slice(0, 80) ?? null })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      customer = await scoped.customers.findFirst(eq(schema.customers.phoneE164, phoneE164))
    }
  }
  if (!customer) throw new Error("whatsapp: no se pudo crear el cliente")

  let conversation = await scoped.conversations.findFirst(eq(schema.conversations.customerId, customer.id))
  if (!conversation) {
    try {
      ;[conversation] = await scoped.conversations.insert({ customerId: customer.id })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      conversation = await scoped.conversations.findFirst(eq(schema.conversations.customerId, customer.id))
    }
  }
  if (!conversation) throw new Error("whatsapp: no se pudo crear la conversación")
  return { customer, conversation }
}

type Prepared = Pick<HandleMessageInput, "text" | "stored" | "autoReply">

/** Convierte el mensaje del cliente en lo que lee el bot (y cómo se guarda). */
async function prepare(
  scoped: ScopedDb,
  api: WhatsAppApi,
  customer: schema.Customer,
  content: Extract<WebhookEvent, { kind: "message" }>["content"],
  deps: WhatsAppDeps,
): Promise<Prepared> {
  switch (content.type) {
    case "text": {
      const command = optOutCommand(content.text)
      if (command) {
        await scoped.customers.update(eq(schema.customers.id, customer.id), { optedOut: command === "opt_out" })
        return { text: content.text, autoReply: command === "opt_out" ? OPT_OUT_REPLY : OPT_IN_REPLY }
      }
      return { text: content.text }
    }

    case "audio": {
      const stored = { type: "audio" as const, body: null, mediaId: content.mediaId }
      if (!deps.transcriber) return { text: "(audio)", stored, autoReply: AUDIO_UNAVAILABLE_REPLY }
      try {
        const media = await api.downloadMedia(content.mediaId)
        const mime = content.mimeType ?? media.mimeType
        if (audioDurationSeconds(media.data, mime) > MAX_AUDIO_SECONDS) {
          return { text: "(audio largo)", stored, autoReply: AUDIO_TOO_LONG_REPLY }
        }
        const transcript = (await deps.transcriber.transcribe(media.data, mime, "es")).trim()
        if (!transcript) return { text: "(audio)", stored, autoReply: AUDIO_FAILED_REPLY }
        return { text: transcript, stored: { ...stored, transcript } }
      } catch (error) {
        console.error("[whatsapp] no se pudo transcribir el audio", error)
        return { text: "(audio)", stored, autoReply: AUDIO_FAILED_REPLY }
      }
    }

    case "image": {
      let description: string | null = null
      if (deps.describer) {
        try {
          const media = await api.downloadMedia(content.mediaId)
          description = (await deps.describer.describe(media.data, content.mimeType ?? media.mimeType)).trim() || null
        } catch (error) {
          console.error("[whatsapp] no se pudo describir la imagen", error)
        }
      }
      const seen = description ? `(Mandó una imagen: ${description})` : "(Mandó una imagen que no se pudo ver)"
      const text = content.caption ? `${seen}\n${content.caption}` : seen
      return { text, stored: { type: "image", body: content.caption, transcript: text, mediaId: content.mediaId } }
    }

    case "choice": {
      const text = choiceText(content)
      return { text, stored: { type: "interactive", body: text } }
    }

    case "template_button":
      return { text: content.text, stored: { type: "interactive", body: content.text } }

    case "unsupported": {
      const text = unsupportedText(content.what)
      return { text, autoReply: UNSUPPORTED_REPLY }
    }
  }
}

/** Modelo que nunca se llama: la conversación ya quedó para una persona. */
const unavailableModel: BotModel = {
  name: "sin-ia",
  async create() {
    throw new Error("Falta ANTHROPIC_API_KEY")
  },
}

async function handleInbound(
  scoped: ScopedDb,
  account: schema.WhatsAppAccount,
  event: Extract<WebhookEvent, { kind: "message" }>,
  deps: WhatsAppDeps,
) {
  // Reintento de Meta: ya lo tenemos (el índice único del wamid lo frena igual, pero así no se transcribe dos veces).
  if (await scoped.messages.findFirst(eq(schema.messages.wamid, event.wamid))) return

  const phone = `+${event.from.replace(/\D/g, "")}`
  const { customer, conversation } = await findOrCreateConversation(scoped, phone, event.profileName)
  const api = deps.api(account)

  // Visto y "escribiendo…" mientras el bot prepara la respuesta.
  if (conversation.mode === "bot") {
    await api.markRead(event.wamid, { typing: true }).catch((error: unknown) => {
      console.warn("[whatsapp] no se pudo marcar como leído", error)
    })
  }

  const prepared = await prepare(scoped, api, customer, event.content, deps)

  // Sin IA configurada, el mensaje queda para que lo responda una persona.
  if (!deps.model && !prepared.autoReply && conversation.mode === "bot") {
    await scoped.conversations.update(eq(schema.conversations.id, conversation.id), { mode: "human" })
  }

  await handleIncomingMessage({
    scoped,
    conversationId: conversation.id,
    channel: "whatsapp",
    model: deps.model ?? unavailableModel,
    wamid: event.wamid,
    now: deps.now,
    ...prepared,
    onReply: async (message) => {
      await deliverMessage(scoped, api, customer.phoneE164, message)
    },
  })
}
