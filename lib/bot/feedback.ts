import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm"

import type { MessageTrace } from "@/lib/bot/engine"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

/*
 * Opiniones del equipo sobre las respuestas del bot (docs/SPEC.md, Fase 7:
 * "ajustes del bot con conversaciones reales"). En la conversación, dueño y
 * admins marcan una respuesta como buena o mala y anotan qué tendría que haber
 * dicho; eso alimenta la revisión de los pilotos (/admin) y los ajustes del
 * prompt y de las preguntas frecuentes.
 */

export type BotRating = (typeof schema.botFeedbackRatingEnum.enumValues)[number]

export class FeedbackError extends Error {}

/** Guarda (o reemplaza) la opinión sobre una respuesta del bot. Solo se opina sobre mensajes del bot. */
export async function rateBotReply(
  scoped: ScopedDb,
  input: { messageId: string; rating: BotRating; note: string | null; userId: string },
): Promise<schema.BotFeedback> {
  const message = await scoped.messages.findById(input.messageId)
  if (!message || message.direction !== "outbound" || message.sentBy) {
    throw new FeedbackError("Solo se pueden calificar respuestas del bot.")
  }
  const note = input.note?.trim() || null
  const existing = await scoped.botFeedback.findFirst(eq(schema.botFeedback.messageId, message.id))
  if (existing) {
    const [row] = await scoped.botFeedback.update(eq(schema.botFeedback.id, existing.id), {
      rating: input.rating,
      note,
      createdBy: input.userId,
    })
    return row!
  }
  const [row] = await scoped.botFeedback.insert({
    messageId: message.id,
    conversationId: message.conversationId,
    rating: input.rating,
    note,
    createdBy: input.userId,
  })
  return row!
}

export async function clearBotRating(scoped: ScopedDb, messageId: string): Promise<void> {
  await scoped.botFeedback.delete(eq(schema.botFeedback.messageId, messageId))
}

/** Opiniones de los mensajes de una conversación, por id de mensaje. */
export async function ratingsFor(scoped: ScopedDb, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, schema.BotFeedback>()
  const rows = await scoped.botFeedback.findMany({ where: inArray(schema.botFeedback.messageId, messageIds) })
  return new Map(rows.map((r) => [r.messageId, r]))
}

export type ReviewedReply = {
  feedbackId: string
  conversationId: string
  rating: BotRating
  note: string | null
  at: Date
  /** Lo que escribió el cliente justo antes (texto o transcripción). */
  customerText: string
  reply: string
  /** Herramientas que usó el bot para esa respuesta. */
  tools: string[]
  error: string | null
}

function textOf(m: Pick<schema.Message, "body" | "transcript" | "type">): string {
  return ((m.type === "audio" ? m.transcript : m.body) ?? m.transcript ?? "").trim()
}

/** Últimas respuestas calificadas, con el mensaje del cliente que contestaban. */
export async function reviewedReplies(
  scoped: ScopedDb,
  options: { rating?: BotRating; since?: Date; limit?: number } = {},
): Promise<ReviewedReply[]> {
  const feedback = await scoped.botFeedback.findMany({
    where: and(
      options.rating ? eq(schema.botFeedback.rating, options.rating) : undefined,
      options.since ? gte(schema.botFeedback.createdAt, options.since) : undefined,
    ),
    orderBy: desc(schema.botFeedback.createdAt),
    limit: options.limit ?? 20,
  })
  if (feedback.length === 0) return []
  const replies = await scoped.messages.findMany({
    where: inArray(schema.messages.id, feedback.map((f) => f.messageId)),
  })
  const replyById = new Map(replies.map((m) => [m.id, m]))

  const result: ReviewedReply[] = []
  for (const f of feedback) {
    const reply = replyById.get(f.messageId)
    if (!reply) continue
    const before = await scoped.messages.findFirst(
      and(
        eq(schema.messages.conversationId, reply.conversationId),
        eq(schema.messages.direction, "inbound"),
        lt(schema.messages.createdAt, reply.createdAt),
      ),
      desc(schema.messages.createdAt),
    )
    const trace = reply.toolTrace as MessageTrace | null
    result.push({
      feedbackId: f.id,
      conversationId: f.conversationId,
      rating: f.rating,
      note: f.note,
      at: f.createdAt,
      customerText: before ? textOf(before) : "",
      reply: reply.body ?? "",
      tools: trace?.tools.map((t) => t.name) ?? [],
      error: trace?.error ?? null,
    })
  }
  return result
}

/** Contexto de una respuesta para la revisión: los mensajes previos de la conversación, del más viejo al más nuevo. */
export async function replyContext(scoped: ScopedDb, messageId: string, size = 8) {
  const reply = await scoped.messages.findById(messageId)
  if (!reply) return []
  const previous = await scoped.messages.findMany({
    where: and(eq(schema.messages.conversationId, reply.conversationId), lt(schema.messages.createdAt, reply.createdAt)),
    orderBy: desc(schema.messages.createdAt),
    limit: size,
  })
  return [...previous.reverse(), reply].map((m) => ({
    id: m.id,
    from: m.direction === "inbound" ? ("cliente" as const) : m.sentBy ? ("equipo" as const) : ("bot" as const),
    text: textOf(m),
    tools: ((m.toolTrace as MessageTrace | null)?.tools ?? []).map((t) => t.name),
    at: m.createdAt,
  }))
}

/** Respuestas del bot que fallaron (sin opinión del equipo): también hay que revisarlas. */
export async function botErrorsSince(scoped: ScopedDb, since: Date): Promise<number> {
  return scoped.messages.count(
    and(
      eq(schema.messages.direction, "outbound"),
      isNull(schema.messages.sentBy),
      gte(schema.messages.createdAt, since),
      sql`${schema.messages.toolTrace}->>'error' is not null`,
    ),
  )
}
