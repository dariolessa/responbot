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

// Coexistencia (app WhatsApp Business + Cloud API en el mismo número).
const metadata = z.object({ phone_number_id: z.string(), display_phone_number: z.string().optional() })

/** Lo que el dueño mandó desde la app del celular (campo smb_message_echoes). */
const echoesValue = z.object({
  metadata,
  message_echoes: z.array(inboundMessage.extend({ to: z.string() })).optional(),
})

const historyMessage = inboundMessage.extend({
  to: z.string().optional(),
  history_context: z.object({ status: z.string().optional() }).optional(),
})

/** Historial de chats de la app, en tandas (campo history). */
const historyValue = z.object({
  metadata,
  history: z
    .array(
      z.object({
        metadata: z
          .object({ phase: z.number().optional(), chunk_order: z.number().optional(), progress: z.number().optional() })
          .optional(),
        threads: z.array(z.object({ id: z.string(), messages: z.array(historyMessage).optional() })).optional(),
        errors: z.array(z.object({ code: z.number().optional(), message: z.string().optional() })).optional(),
      }),
    )
    .optional(),
})

/** Contactos de la app (campo smb_app_state_sync). */
const stateSyncValue = z.object({
  metadata,
  state_sync: z
    .array(
      z.object({
        type: z.string(),
        action: z.string().optional(),
        contact: z
          .object({ full_name: z.string().optional(), first_name: z.string().optional(), phone_number: z.string() })
          .optional(),
      }),
    )
    .optional(),
})

/** Meta no compartió el historial porque el dueño no lo aceptó en la app. */
export const HISTORY_DECLINED_CODE = 2593109

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
  | {
      /** Mensaje que mandó el dueño desde la app del celular (coexistencia). */
      kind: "echo"
      phoneNumberId: string
      /** wa_id del cliente al que le escribió. */
      to: string
      wamid: string
      at: Date | null
      content: InboundContent
    }
  | {
      /** Una tanda del historial de chats de la app (coexistencia). */
      kind: "history"
      phoneNumberId: string
      /** 0 a 100, si Meta lo informa. */
      progress: number | null
      /** Código de error de Meta (por ejemplo HISTORY_DECLINED_CODE), o null. */
      errorCode: number | null
      threads: { waId: string; messages: HistoryMessage[] }[]
    }
  | {
      /** Contactos de la app agregados o quitados (coexistencia). */
      kind: "contacts"
      phoneNumberId: string
      contacts: { waId: string; name: string | null; action: "add" | "remove" }[]
    }

export type HistoryMessage = {
  wamid: string
  direction: "inbound" | "outbound"
  at: Date | null
  content: InboundContent
  /** Estado que informa Meta para lo que mandó el negocio (sent, delivered, read…). */
  status: string | null
}

function dateOf(timestamp: string | undefined): Date | null {
  const seconds = Number(timestamp)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

const SKIPPED_TYPES = new Set(["reaction", "edit", "revoke", "errors"])

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
      if (change.field === "smb_message_echoes") {
        const value = echoesValue.safeParse(change.value)
        if (!value.success) continue
        for (const message of value.data.message_echoes ?? []) {
          if (SKIPPED_TYPES.has(message.type)) continue
          events.push({
            kind: "echo",
            phoneNumberId: value.data.metadata.phone_number_id,
            to: message.to,
            wamid: message.id,
            at: dateOf(message.timestamp),
            content: contentOf(message),
          })
        }
        continue
      }
      if (change.field === "history") {
        const value = historyValue.safeParse(change.value)
        if (!value.success) continue
        for (const chunk of value.data.history ?? []) {
          events.push({
            kind: "history",
            phoneNumberId: value.data.metadata.phone_number_id,
            progress: chunk.metadata?.progress ?? null,
            errorCode: chunk.errors?.[0]?.code ?? null,
            threads: (chunk.threads ?? []).map((thread) => ({
              waId: thread.id,
              messages: (thread.messages ?? [])
                .filter((m) => !SKIPPED_TYPES.has(m.type))
                .map((m) => ({
                  wamid: m.id,
                  // En el hilo de un cliente, lo que no viene de su número lo mandó el negocio.
                  direction: m.from === thread.id ? ("inbound" as const) : ("outbound" as const),
                  at: dateOf(m.timestamp),
                  content: contentOf(m),
                  status: m.history_context?.status?.toLowerCase() ?? null,
                })),
            })),
          })
        }
        continue
      }
      if (change.field === "smb_app_state_sync") {
        const value = stateSyncValue.safeParse(change.value)
        if (!value.success) continue
        const contacts = (value.data.state_sync ?? []).flatMap((item) => {
          if (item.type !== "contact" || !item.contact) return []
          const name = item.contact.full_name?.trim() || item.contact.first_name?.trim() || null
          return [{ waId: item.contact.phone_number, name, action: item.action === "remove" ? ("remove" as const) : ("add" as const) }]
        })
        if (contacts.length > 0) {
          events.push({ kind: "contacts", phoneNumberId: value.data.metadata.phone_number_id, contacts })
        }
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
        events.push({
          kind: "message",
          phoneNumberId: metadata.phone_number_id,
          from: message.from,
          profileName: names.get(message.from) ?? null,
          wamid: message.id,
          at: dateOf(message.timestamp),
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
