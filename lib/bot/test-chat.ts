import { and, asc, eq, gte, inArray } from "drizzle-orm"

import { changeBookingStatus, type Actor } from "@/lib/booking/create"
import { openStatuses } from "@/lib/booking/policies"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

import type { MessageTrace } from "./engine"

/*
 * Chat de prueba del panel (/app/bot): cada persona del equipo conversa con
 * el bot como si fuera un cliente. Usa un cliente ficticio propio
 * (customers.is_test) y el mismo motor que WhatsApp; los turnos que reserva
 * son reales en la agenda, con origen "test_chat".
 */

/** Teléfono ficticio del cliente de prueba: no es E.164, así nunca coincide con uno real. */
export function testPhoneFor(userId: string) {
  return `test:${userId}`
}

export async function getTestConversation(scoped: ScopedDb, userId: string) {
  const phone = testPhoneFor(userId)
  let customer = await scoped.customers.findFirst(eq(schema.customers.phoneE164, phone))
  if (!customer) {
    ;[customer] = await scoped.customers.insert({ phoneE164: phone, isTest: true })
  }
  let conversation = await scoped.conversations.findFirst(eq(schema.conversations.customerId, customer!.id))
  if (!conversation) {
    ;[conversation] = await scoped.conversations.insert({ customerId: customer!.id })
  }
  return { customer: customer!, conversation: conversation! }
}

/**
 * Empieza de cero: borra los mensajes, devuelve la conversación al bot,
 * olvida el nombre del cliente ficticio y cancela sus turnos y esperas abiertos.
 */
export async function resetTestConversation(scoped: ScopedDb, userId: string) {
  const { customer, conversation } = await getTestConversation(scoped, userId)
  const actor: Actor = { type: "user", id: userId, channel: "panel" }

  const open = await scoped.bookings.findMany({
    where: and(
      eq(schema.bookings.customerId, customer.id),
      gte(schema.bookings.startsAt, new Date()),
      inArray(schema.bookings.status, [...openStatuses]),
    ),
  })
  for (const booking of open) {
    await changeBookingStatus(
      scoped,
      { bookingId: booking.id, to: "cancelled", cancelReason: "Chat de prueba reiniciado" },
      actor,
    )
  }

  await scoped.transaction(async (tx) => {
    await tx.messages.delete(eq(schema.messages.conversationId, conversation.id))
    await tx.waitlistEntries.delete(eq(schema.waitlistEntries.customerId, customer.id))
    await tx.conversations.update(eq(schema.conversations.id, conversation.id), {
      mode: "bot",
      lockedUntil: null,
      lastInboundAt: null,
      unreadCount: 0,
    })
    await tx.customers.update(eq(schema.customers.id, customer.id), { name: null, notes: null })
  })
  return { cancelledBookings: open.length }
}

/** Mensaje del chat de prueba tal como lo muestra el panel. */
export type ChatMessage = {
  id: string
  direction: "inbound" | "outbound"
  body: string
  at: string
  /** Herramientas que usó el bot para esa respuesta, para que el dueño vea qué consultó. */
  tools: { name: string; ok: boolean }[]
  failed: boolean
}

export type ChatState = { messages: ChatMessage[]; humanMode: boolean }

function toChatMessage(m: schema.Message): ChatMessage {
  const trace = m.toolTrace as MessageTrace | null
  return {
    id: m.id,
    direction: m.direction,
    body: m.body ?? "",
    at: m.createdAt.toISOString(),
    tools: trace?.tools.map((t) => ({ name: t.name, ok: t.ok })) ?? [],
    failed: Boolean(trace?.error),
  }
}

export async function loadTestChat(scoped: ScopedDb, userId: string): Promise<ChatState> {
  const { conversation } = await getTestConversation(scoped, userId)
  const rows = await scoped.messages.findMany({
    where: eq(schema.messages.conversationId, conversation.id),
    orderBy: [asc(schema.messages.createdAt)],
    limit: 200,
  })
  return { messages: rows.map(toChatMessage), humanMode: conversation.mode === "human" }
}
