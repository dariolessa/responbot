import { eq } from "drizzle-orm"

import { previewOf } from "@/lib/bot/engine"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { WhatsAppApi } from "@/lib/integrations/whatsapp/client"

import { isWindowOpen } from "./messages"
import { deliverMessage } from "./outbound"

/*
 * Lo que hace el equipo desde la bandeja de conversaciones (docs/SPEC.md,
 * "Conversaciones"): tomar una conversación (el bot deja de responder),
 * devolverla al bot y responder por WhatsApp desde el panel.
 */

export class InboxError extends Error {}

export async function takeConversation(scoped: ScopedDb, conversationId: string, userId: string) {
  const [row] = await scoped.conversations.update(eq(schema.conversations.id, conversationId), {
    mode: "human",
    assignedTo: userId,
    unreadCount: 0,
  })
  if (!row) throw new InboxError("No encontramos la conversación.")
  return row
}

export async function releaseConversation(scoped: ScopedDb, conversationId: string) {
  const [row] = await scoped.conversations.update(eq(schema.conversations.id, conversationId), {
    mode: "bot",
    assignedTo: null,
    lockedUntil: null,
    unreadCount: 0,
  })
  if (!row) throw new InboxError("No encontramos la conversación.")
  return row
}

export async function markConversationRead(scoped: ScopedDb, conversationId: string) {
  await scoped.conversations.update(eq(schema.conversations.id, conversationId), { unreadCount: 0 })
}

/**
 * Respuesta escrita por una persona del equipo. Solo dentro de la ventana de
 * 24 horas; la conversación pasa a modo humano a su nombre si estaba con el bot.
 */
export async function sendPanelReply(
  scoped: ScopedDb,
  input: { conversationId: string; userId: string; text: string },
  api: WhatsAppApi | null,
  now: Date = new Date(),
): Promise<schema.Message> {
  const conversation = await scoped.conversations.findById(input.conversationId)
  if (!conversation) throw new InboxError("No encontramos la conversación.")
  const customer = await scoped.customers.findById(conversation.customerId)
  if (!customer || customer.isTest) throw new InboxError("Esta conversación no es de WhatsApp.")
  if (!isWindowOpen(conversation.lastInboundAt, now)) {
    throw new InboxError(
      "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo deja escribirle con una plantilla aprobada.",
    )
  }
  if (!api) throw new InboxError("WhatsApp no está conectado. Conectalo desde Configuración.")

  const [message] = await scoped.messages.insert({
    conversationId: conversation.id,
    direction: "outbound",
    type: "text",
    body: input.text,
    status: "queued",
    sentBy: input.userId,
    createdAt: now,
  })
  await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
    mode: "human",
    assignedTo: conversation.assignedTo ?? input.userId,
    unreadCount: 0,
    lastMessageAt: now,
    lastMessagePreview: previewOf(message!),
  })
  return deliverMessage(scoped, api, customer.phoneE164, message!)
}
