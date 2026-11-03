import { eq, inArray } from "drizzle-orm"

import { previewOf } from "@/lib/bot/engine"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { GraphOptions } from "@/lib/integrations/whatsapp/graph"
import { requestAppSync, type AppSyncType } from "@/lib/integrations/whatsapp/signup"
import {
  HISTORY_DECLINED_CODE,
  type InboundContent,
  type WebhookEvent,
} from "@/lib/integrations/whatsapp/webhook"

import { findOrCreateConversation } from "./inbound"
import { unsupportedText } from "./messages"

/*
 * Coexistencia (docs/WHATSAPP.md, "Mismo número en el celular"): el número
 * del negocio sigue andando en la app WhatsApp Business del celular y además
 * en Cloud API. Lo que llega por acá:
 *
 * - Ecos (smb_message_echoes): lo que el dueño contesta desde el celular se
 *   guarda en la conversación y el bot se calla con ese cliente por un rato
 *   (PHONE_PAUSE_HOURS), para no pisarle la charla.
 * - Historial (history): los chats de los últimos meses de la app, si el
 *   dueño aceptó compartirlos. Se guardan sin responder nada.
 * - Contactos (smb_app_state_sync): pasan a Clientes con su nombre.
 */

/** Horas que el bot no le responde a un cliente después de que el dueño le escribió desde el celular. */
export const PHONE_PAUSE_HOURS = 12

/** Meta acepta el pedido de contactos e historial solo en las 24 horas siguientes al alta. */
export const SYNC_WINDOW_HOURS = 24

const phoneOf = (waId: string) => `+${waId.replace(/\D/g, "")}`

type Stored = Partial<Pick<schema.Message, "body" | "mediaId" | "transcript">> & { type: schema.Message["type"] }

/** Cómo se guarda un mensaje del eco o del historial (no se transcribe ni se describe). */
function storedOf(content: InboundContent): Stored {
  switch (content.type) {
    case "text":
      return { type: "text", body: content.text }
    case "audio":
      return { type: "audio", body: null, mediaId: content.mediaId, transcript: "(audio)" }
    case "image":
      return { type: "image", body: content.caption, mediaId: content.mediaId }
    case "choice":
      return { type: "interactive", body: content.title }
    case "template_button":
      return { type: "interactive", body: content.text }
    case "unsupported":
      return { type: "text", body: unsupportedText(content.what).replace("Mandó", "Se mandó") }
  }
}

/** Mensaje que el dueño mandó desde la app del celular. */
export async function handleEcho(
  scoped: ScopedDb,
  event: Extract<WebhookEvent, { kind: "echo" }>,
  now: Date = new Date(),
): Promise<void> {
  if (await scoped.messages.findFirst(eq(schema.messages.wamid, event.wamid))) return
  const { conversation } = await findOrCreateConversation(scoped, phoneOf(event.to), null)
  const at = event.at ?? now

  const [message] = await scoped.messages.insert({
    conversationId: conversation.id,
    direction: "outbound",
    wamid: event.wamid,
    status: "sent",
    fromPhone: true,
    createdAt: at,
    ...storedOf(event.content),
  })

  // Lo tomado desde el panel (modo humano sin vencimiento) queda como está.
  const takenFromPanel = conversation.mode === "human" && !conversation.humanUntil
  await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
    ...(takenFromPanel
      ? {}
      : { mode: "human" as const, humanUntil: new Date(now.getTime() + PHONE_PAUSE_HOURS * 3_600_000) }),
    unreadCount: 0,
    ...(!conversation.lastMessageAt || conversation.lastMessageAt <= at
      ? { lastMessageAt: at, lastMessagePreview: previewOf(message!) }
      : {}),
  })
}

/**
 * Si el bot estaba en pausa porque el dueño respondió desde el celular y ya
 * pasó la pausa, la conversación vuelve al bot. Devuelve true si cambió.
 */
export async function resumeBotAfterPhonePause(
  scoped: ScopedDb,
  conversation: schema.Conversation,
  now: Date,
): Promise<boolean> {
  if (conversation.mode !== "human" || !conversation.humanUntil || conversation.humanUntil > now) return false
  await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
    mode: "bot",
    humanUntil: null,
    assignedTo: null,
  })
  return true
}

const historyStatus: Record<string, schema.Message["status"]> = {
  pending: "sent",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  played: "read",
  error: "failed",
  failed: "failed",
}

/** Una tanda del historial de la app: guarda los mensajes que falten, sin responder ni sumar sin leer. */
export async function applyHistory(
  scoped: ScopedDb,
  account: schema.WhatsAppAccount,
  event: Extract<WebhookEvent, { kind: "history" }>,
): Promise<number> {
  if (event.errorCode !== null) {
    const declined = event.errorCode === HISTORY_DECLINED_CODE
    await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, account.id), {
      historySync: declined ? "declined" : "failed",
    })
    return 0
  }

  let imported = 0
  for (const thread of event.threads) {
    // Solo chats con una persona (los grupos no tienen un número de teléfono como id).
    if (!/^\d{6,15}$/.test(thread.waId) || thread.messages.length === 0) continue
    const { conversation } = await findOrCreateConversation(scoped, phoneOf(thread.waId), null)

    const wamids = thread.messages.map((m) => m.wamid)
    const known = new Set(
      (await scoped.messages.findMany({ where: inArray(schema.messages.wamid, wamids) })).map((m) => m.wamid),
    )
    const rows = thread.messages
      .filter((m) => m.at && !known.has(m.wamid))
      .map((m) => ({
        conversationId: conversation.id,
        direction: m.direction,
        wamid: m.wamid,
        status:
          m.direction === "inbound" ? ("received" as const) : (historyStatus[m.status ?? ""] ?? ("sent" as const)),
        fromPhone: m.direction === "outbound",
        createdAt: m.at!,
        ...storedOf(m.content),
      }))
    if (rows.length === 0) continue
    const inserted = await scoped.messages.insert(rows)
    imported += inserted.length

    const latest = inserted.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
    if (!conversation.lastMessageAt || conversation.lastMessageAt < latest.createdAt) {
      await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
        lastMessageAt: latest.createdAt,
        lastMessagePreview: previewOf(latest),
      })
    }
  }

  const done = event.progress !== null && event.progress >= 100
  await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, account.id), {
    historySync: done ? "done" : "in_progress",
    ...(event.progress !== null ? { historyProgress: Math.min(100, Math.max(0, Math.round(event.progress))) } : {}),
  })
  return imported
}

/**
 * Contactos de la app: los nuevos pasan a Clientes y los que no tenían nombre
 * lo toman de la agenda del celular. Un contacto borrado en el celular no se
 * borra de Responbot (puede tener turnos e historial).
 */
export async function applyContacts(
  scoped: ScopedDb,
  account: schema.WhatsAppAccount,
  event: Extract<WebhookEvent, { kind: "contacts" }>,
): Promise<number> {
  let added = 0
  for (const contact of event.contacts) {
    if (contact.action !== "add" || !/^\d{6,15}$/.test(contact.waId.replace(/\D/g, ""))) continue
    const phone = phoneOf(contact.waId)
    const name = contact.name?.slice(0, 80) ?? null
    const existing = await scoped.customers.findFirst(eq(schema.customers.phoneE164, phone))
    if (!existing) {
      await scoped.customers.insert({ phoneE164: phone, name })
      added++
    } else if (!existing.name?.trim() && name) {
      await scoped.customers.update(eq(schema.customers.id, existing.id), { name })
    }
  }
  if (account.contactsSync !== "done") {
    await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, account.id), { contactsSync: "done" })
  }
  return added
}

/** ¿Todavía se puede pedir contactos o historial a Meta? */
export function syncWindowOpen(account: Pick<schema.WhatsAppAccount, "coexistence" | "coexistenceAt">, now: Date) {
  return (
    account.coexistence &&
    account.coexistenceAt !== null &&
    now.getTime() - account.coexistenceAt.getTime() < SYNC_WINDOW_HOURS * 3_600_000
  )
}

/**
 * Pide a Meta los contactos y el historial de la app (lo que no se haya
 * pedido ya con éxito). Primero contactos y después historial, como indica
 * Meta. Devuelve qué pedidos fallaron.
 */
export async function requestAppSyncs(
  scoped: ScopedDb,
  account: schema.WhatsAppAccount,
  graph: GraphOptions,
  now: Date = new Date(),
): Promise<AppSyncType[]> {
  if (!syncWindowOpen(account, now)) return []
  const failed: AppSyncType[] = []
  const pending: { type: AppSyncType; column: "contactsSync" | "historySync" }[] = [
    { type: "smb_app_state_sync", column: "contactsSync" },
    { type: "history", column: "historySync" },
  ]
  for (const { type, column } of pending) {
    const current = account[column]
    if (current !== null && current !== "failed") continue
    let status: "requested" | "failed" = "requested"
    try {
      await requestAppSync(account.phoneNumberId, type, graph)
    } catch (error) {
      console.error("[whatsapp] no se pudo pedir la sincronización", type, error)
      status = "failed"
      failed.push(type)
    }
    await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, account.id), { [column]: status })
  }
  return failed
}
