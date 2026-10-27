import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/*
 * Webhook de WhatsApp Cloud API (docs/SPEC.md, "WhatsApp Cloud API"):
 * verificación de la firma X-Hub-Signature-256 y lectura de los eventos.
 *
 * El cuerpo se valida con Zod de forma tolerante: Meta agrega campos nuevos
 * seguido, así que solo se exige lo que usamos y el resto se ignora.
 */

/** Compara la firma `sha256=<hex>` con el HMAC del cuerpo crudo y el app secret. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")
  const a = Buffer.from(header.slice("sha256=".length), "utf8")
  const b = Buffer.from(expected, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`
}

const media = z.object({ id: z.string(), mime_type: z.string().optional() })

const inboundMessage = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: media.extend({ voice: z.boolean().optional() }).optional(),
  image: media.extend({ caption: z.string().optional() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
    })
    .optional(),
  button: z.object({ payload: z.string().optional(), text: z.string() }).optional(),
})

const status = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() })).optional(),
})

const messagesValue = z.object({
  metadata: z.object({ phone_number_id: z.string(), display_phone_number: z.string().optional() }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(inboundMessage).optional(),
  statuses: z.array(status).optional(),
})

export const webhookPayload = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
})

export type WebhookPayload = z.infer<typeof webhookPayload>

export type InboundContent =
  | { type: "text"; text: string }
  | { type: "audio"; mediaId: string; mimeType: string | null }
  | { type: "image"; mediaId: string; mimeType: string | null; caption: string | null }
  /** El cliente tocó un botón o eligió de una lista que mandó el bot. */
  | { type: "choice"; id: string; title: string; description: string | null }
  /** Botón de respuesta rápida de una plantilla (por ejemplo "Confirmo" en un recordatorio). */
  | { type: "template_button"; payload: string | null; text: string }
  | { type: "unsupported"; what: string }

export type WebhookEvent =
  | {
      kind: "message"
      phoneNumberId: string
      /** wa_id del cliente: el número sin "+". */
      from: string
      profileName: string | null
      wamid: string
      at: Date | null
      content: InboundContent
    }
  | {
      kind: "status"
      phoneNumberId: string
      wamid: string
      status: "sent" | "delivered" | "read" | "failed"
      error: string | null
      errorCode: number | null
    }
  | { kind: "account"; wabaId: string; event: string }

function contentOf(message: z.infer<typeof inboundMessage>): InboundContent {
  switch (message.type) {
    case "text":
      return message.text ? { type: "text", text: message.text.body } : { type: "unsupported", what: "text" }
    case "audio":
      return message.audio
        ? { type: "audio", mediaId: message.audio.id, mimeType: message.audio.mime_type ?? null }
        : { type: "unsupported", what: "audio" }
    case "image":
      return message.image
        ? {
            type: "image",
            mediaId: message.image.id,
            mimeType: message.image.mime_type ?? null,
            caption: message.image.caption?.trim() || null,
          }
        : { type: "unsupported", what: "image" }
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply
      if (!reply) return { type: "unsupported", what: "interactive" }
      const description = message.interactive?.list_reply?.description ?? null
      return { type: "choice", id: reply.id, title: reply.title, description }
    }
    case "button":
      return message.button
        ? { type: "template_button", payload: message.button.payload ?? null, text: message.button.text }
        : { type: "unsupported", what: "button" }
    default:
      return { type: "unsupported", what: message.type }
  }
}

const statusValues = new Set(["sent", "delivered", "read", "failed"])

/** Pasa el cuerpo del webhook a una lista de eventos que la app entiende. */
export function parseWebhook(payload: WebhookPayload): WebhookEvent[] {
  const events: WebhookEvent[] = []
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "account_update") {
        const value = z.object({ event: z.string() }).safeParse(change.value)
        if (value.success) events.push({ kind: "account", wabaId: entry.id, event: value.data.event })
        continue
      }
      if (change.field !== "messages") continue
      const value = messagesValue.safeParse(change.value)
      if (!value.success) continue
      const { metadata, contacts = [], messages = [], statuses = [] } = value.data
      const names = new Map(contacts.map((c) => [c.wa_id, c.profile?.name?.trim() || null]))

      for (const message of messages) {
        // Las reacciones no son un mensaje para responder.
        if (message.type === "reaction") continue
        const seconds = Number(message.timestamp)
        events.push({
          kind: "message",
          phoneNumberId: metadata.phone_number_id,
          from: message.from,
          profileName: names.get(message.from) ?? null,
          wamid: message.id,
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
          content: contentOf(message),
        })
      }
      for (const s of statuses) {
        if (!statusValues.has(s.status)) continue
        const error = s.errors?.[0]
        events.push({
          kind: "status",
          phoneNumberId: metadata.phone_number_id,
          wamid: s.id,
          status: s.status as "sent" | "delivered" | "read" | "failed",
          error: error ? (error.message ?? error.title ?? "Error de WhatsApp") : null,
          errorCode: error?.code ?? null,
        })
      }
    }
  }
  return events
}
