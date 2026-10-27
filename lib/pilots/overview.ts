import { and, eq, gte, sql } from "drizzle-orm"

import { billingState, type BillingStatus } from "@/lib/billing/state"
import { botErrorsSince } from "@/lib/bot/feedback"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb, type ScopedDb } from "@/lib/db/scoped"

/*
 * Seguimiento de los pilotos (docs/SPEC.md, Fase 7) para el panel de la
 * plataforma (/admin): qué negocios hay, en qué estado está su cuenta y cómo
 * le fue al bot en los últimos días. Cada negocio se mide con su scope.
 */

const DAY_MS = 86_400_000

export type PilotMetrics = {
  /** Clientes reales que escribieron en el período. */
  conversations: number
  /** Turnos que reservó el bot por WhatsApp. */
  botBookings: number
  /** Veces que el bot pasó la conversación a una persona. */
  handoffs: number
  /** Respuestas del bot que fallaron (error de la IA o de una herramienta). */
  botErrors: number
  goodReplies: number
  badReplies: number
}

export type PilotRow = {
  id: string
  name: string
  slug: string
  createdAt: Date
  ownerEmail: string | null
  status: BillingStatus
  planName: string
  pilotEndsAt: Date | null
  isDemo: boolean
  whatsappConnected: boolean
  metrics: PilotMetrics
}

/** Mensajes de conversaciones con clientes reales (sin el chat de prueba). */
const realMessages = sql`exists (select 1 from ${schema.conversations} c join ${schema.customers} k on k.id = c.customer_id where c.id = ${schema.messages.conversationId} and k.is_test = false)`

export async function pilotMetrics(scoped: ScopedDb, since: Date): Promise<PilotMetrics> {
  const [conversations, botBookings, handoffs, botErrors, goodReplies, badReplies] = await Promise.all([
    scoped.conversations.count(
      and(
        gte(schema.conversations.lastInboundAt, since),
        sql`exists (select 1 from ${schema.customers} k where k.id = ${schema.conversations.customerId} and k.is_test = false)`,
      ),
    ),
    scoped.bookings.count(and(eq(schema.bookings.source, "whatsapp"), gte(schema.bookings.createdAt, since))),
    scoped.messages.count(
      and(
        gte(schema.messages.createdAt, since),
        realMessages,
        sql`${schema.messages.toolTrace}->'tools' @> '[{"name":"handoff_to_human"}]'::jsonb`,
      ),
    ),
    botErrorsSince(scoped, since),
    scoped.botFeedback.count(and(eq(schema.botFeedback.rating, "good"), gte(schema.botFeedback.createdAt, since))),
    scoped.botFeedback.count(and(eq(schema.botFeedback.rating, "bad"), gte(schema.botFeedback.createdAt, since))),
  ])
  return { conversations, botBookings, handoffs, botErrors, goodReplies, badReplies }
}

/** Todos los negocios con su estado y los números de los últimos `days` días. */
export async function pilotOverview(db: AnyDb, now: Date, days = 7): Promise<PilotRow[]> {
  const since = new Date(now.getTime() - days * DAY_MS)
  const rows = await forPlatform(db).businessesForAdmin()
  return Promise.all(
    rows.map(async ({ business, ownerEmail }) => {
      const scoped = forBusiness(db, business.id)
      const state = billingState(business, now)
      const [metrics, account] = await Promise.all([pilotMetrics(scoped, since), scoped.whatsappAccounts.findFirst()])
      return {
        id: business.id,
        name: business.name,
        slug: business.slug,
        createdAt: business.createdAt,
        ownerEmail,
        status: state.status,
        planName: state.plan.name,
        pilotEndsAt: business.pilotEndsAt,
        isDemo: business.isDemo,
        whatsappConnected: account?.status === "active",
        metrics,
      }
    }),
  )
}

/** Marca (o desmarca, con `endsAt` null) un negocio como piloto, y lo anota en la auditoría. */
export async function setPilot(db: AnyDb, input: { businessId: string; endsAt: Date | null; actorId: string }) {
  const scoped = forBusiness(db, input.businessId)
  const business = await scoped.updateBusiness({ pilotEndsAt: input.endsAt })
  if (!business) return null
  await scoped.auditLogs.insert({
    actorId: input.actorId,
    action: input.endsAt ? "platform.pilot_set" : "platform.pilot_removed",
    targetType: "business",
    targetId: business.id,
    metadata: { pilotEndsAt: input.endsAt?.toISOString() ?? null },
  })
  return business
}
