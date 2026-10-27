import { and, desc, eq, gte, inArray, isNotNull, ne, or, sql } from "drizzle-orm"

import { monthUsage, type MonthUsage } from "@/lib/billing/access"
import { billingState, type BillingState } from "@/lib/billing/state"
import type { MessageTrace } from "@/lib/bot/engine"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb, type MemberWithUser, type ScopedDb } from "@/lib/db/scoped"
import { pendingSteps, type Step } from "@/lib/onboarding/steps"
import { pilotMetrics, type PilotMetrics } from "@/lib/pilots/overview"

/*
 * Soporte desde el panel de la plataforma (/admin/soporte): buscar un negocio,
 * ver su ficha completa (cuenta, conexiones, configuración), sus problemas
 * recientes y sus conversaciones. Todo es lectura con el scope del negocio;
 * las acciones (extender la prueba, entrar en modo soporte) están en
 * actions.ts y quedan en la auditoría del negocio.
 */

const DAY_MS = 86_400_000

export type BusinessSummary = {
  id: string
  name: string
  slug: string
  createdAt: Date
  ownerEmail: string | null
  status: BillingState["status"]
  isDemo: boolean
}

/** Negocios que coinciden con la búsqueda (vacía = los últimos dados de alta). */
export async function searchBusinesses(db: AnyDb, term: string, now: Date, limit = 50): Promise<BusinessSummary[]> {
  const platform = forPlatform(db)
  const all = await platform.businessesForAdmin()
  const q = term.trim()
  let rows = all.slice().reverse()
  if (q) {
    const ids = new Set(await platform.searchBusinessIds(q, limit))
    rows = rows.filter((r) => ids.has(r.business.id))
  }
  return rows.slice(0, limit).map(({ business, ownerEmail }) => ({
    id: business.id,
    name: business.name,
    slug: business.slug,
    createdAt: business.createdAt,
    ownerEmail,
    status: billingState(business, now).status,
    isDemo: business.isDemo,
  }))
}

export type Connections = {
  whatsapp: { status: schema.WhatsAppAccount["status"]; displayPhone: string; verifiedName: string | null; since: Date } | null
  mercadopago: { status: schema.MpAccount["status"]; displayName: string | null; liveMode: boolean; expiresAt: Date } | null
  catalog: { url: string; status: schema.CatalogSource["status"]; itemCount: number; lastImportedAt: Date | null; lastError: string | null }[]
}

export type BusinessDetail = {
  business: schema.Business
  billing: BillingState
  usage: MonthUsage
  members: MemberWithUser[]
  connections: Connections
  pendingSteps: Step[]
  counts: { services: number; staff: number; customers: number; upcomingBookings: number; faq: number }
  botConfigured: boolean
  metrics: PilotMetrics
  audit: (typeof schema.auditLogs.$inferSelect & { actorEmail: string | null })[]
}

/** Ficha completa del negocio para dar soporte. Sin tokens ni datos cifrados. */
export async function businessDetail(db: AnyDb, businessId: string, now: Date): Promise<BusinessDetail | null> {
  const scoped = forBusiness(db, businessId)
  const business = await scoped.business()
  if (!business) return null
  const billing = billingState(business, now)

  const [usage, members, whatsapp, mp, catalog, services, staff, customers, upcoming, bot, metrics, audit] =
    await Promise.all([
      monthUsage(scoped, billing, business.timezone, now),
      scoped.members(),
      scoped.whatsappAccounts.findFirst(),
      scoped.mpAccounts.findFirst(),
      scoped.catalogSources.findMany({ orderBy: schema.catalogSources.createdAt }),
      scoped.services.count(eq(schema.services.active, true)),
      scoped.resources.count(eq(schema.resources.active, true)),
      scoped.customers.count(eq(schema.customers.isTest, false)),
      scoped.bookings.count(
        and(gte(schema.bookings.startsAt, now), inArray(schema.bookings.status, ["confirmed", "client_confirmed", "pending_payment"])),
      ),
      scoped.botSettings.findFirst(),
      pilotMetrics(scoped, new Date(now.getTime() - 30 * DAY_MS)),
      scoped.auditLogs.findMany({ orderBy: desc(schema.auditLogs.createdAt), limit: 30 }),
    ])

  const emailById = new Map(members.map((m) => [m.userId, m.email]))
  const missingActors = [...new Set(audit.map((a) => a.actorId).filter((id): id is string => !!id && !emailById.has(id)))]
  if (missingActors.length > 0) {
    for (const u of await forPlatform(db).userEmails(missingActors)) emailById.set(u.id, u.email)
  }

  return {
    business,
    billing,
    usage,
    members,
    connections: {
      whatsapp: whatsapp
        ? { status: whatsapp.status, displayPhone: whatsapp.displayPhone, verifiedName: whatsapp.verifiedName, since: whatsapp.createdAt }
        : null,
      mercadopago: mp
        ? { status: mp.status, displayName: mp.displayName, liveMode: mp.liveMode, expiresAt: mp.expiresAt }
        : null,
      catalog: catalog.map((c) => ({
        url: c.url,
        status: c.status,
        itemCount: c.itemCount,
        lastImportedAt: c.lastImportedAt,
        lastError: c.lastError,
      })),
    },
    pendingSteps: pendingSteps(business.onboardingCompleted).filter((s) => s.available && !s.optional),
    counts: { services, staff, customers, upcomingBookings: upcoming, faq: bot?.faq.length ?? 0 },
    botConfigured: !!bot,
    metrics,
    audit: audit.map((a) => ({ ...a, actorEmail: a.actorId ? (emailById.get(a.actorId) ?? null) : null })),
  }
}

export type ProblemKind = "bot" | "whatsapp" | "scheduled" | "notification" | "catalog"

export type Problem = {
  kind: ProblemKind
  at: Date
  /** Qué pasó, en pocas palabras. */
  title: string
  detail: string | null
  conversationId: string | null
}

/** Lo que falló en los últimos `days` días, del más nuevo al más viejo. */
export async function recentProblems(scoped: ScopedDb, now: Date, days = 14, limit = 50): Promise<Problem[]> {
  const since = new Date(now.getTime() - days * DAY_MS)
  const [botErrors, failedMessages, scheduled, notifications, catalog] = await Promise.all([
    scoped.messages.findMany({
      where: and(
        eq(schema.messages.direction, "outbound"),
        gte(schema.messages.createdAt, since),
        sql`${schema.messages.toolTrace}->>'error' is not null`,
      ),
      orderBy: desc(schema.messages.createdAt),
      limit,
    }),
    scoped.messages.findMany({
      where: and(
        gte(schema.messages.createdAt, since),
        or(eq(schema.messages.status, "failed"), isNotNull(schema.messages.error)),
      ),
      orderBy: desc(schema.messages.createdAt),
      limit,
    }),
    scoped.scheduledMessages.findMany({
      where: and(
        gte(schema.scheduledMessages.updatedAt, since),
        or(eq(schema.scheduledMessages.status, "failed"), isNotNull(schema.scheduledMessages.lastError)),
      ),
      orderBy: desc(schema.scheduledMessages.updatedAt),
      limit,
    }),
    scoped.notifications.findMany({
      where: and(
        gte(schema.notifications.createdAt, since),
        sql`exists (select 1 from jsonb_each_text(${schema.notifications.sentStatus}) s where s.value = 'failed')`,
      ),
      orderBy: desc(schema.notifications.createdAt),
      limit,
    }),
    scoped.catalogSources.findMany({ where: and(eq(schema.catalogSources.status, "error"), ne(schema.catalogSources.url, "")) }),
  ])

  const problems: Problem[] = [
    ...botErrors.map((m) => ({
      kind: "bot" as const,
      at: m.createdAt,
      title: "El bot no pudo responder bien",
      detail: (m.toolTrace as MessageTrace | null)?.error ?? null,
      conversationId: m.conversationId,
    })),
    ...failedMessages.map((m) => ({
      kind: "whatsapp" as const,
      at: m.createdAt,
      title: m.direction === "outbound" ? "WhatsApp no entregó un mensaje" : "Falló un mensaje recibido",
      detail: m.error,
      conversationId: m.conversationId,
    })),
    ...scheduled.map((s) => ({
      kind: "scheduled" as const,
      at: s.updatedAt,
      title: `No salió un mensaje programado (${scheduledLabels[s.kind] ?? s.kind})`,
      detail: s.lastError,
      conversationId: null,
    })),
    ...notifications.map((n) => ({
      kind: "notification" as const,
      at: n.createdAt,
      title: `Falló un aviso al equipo (${n.type})`,
      detail: Object.entries(n.sentStatus)
        .filter(([, v]) => v === "failed")
        .map(([channel]) => channel)
        .join(", "),
      conversationId: null,
    })),
    ...catalog
      .filter((c) => (c.lastImportedAt ?? c.updatedAt) >= since)
      .map((c) => ({
        kind: "catalog" as const,
        at: c.lastImportedAt ?? c.updatedAt,
        title: `Falló la importación del catálogo (${c.url})`,
        detail: c.lastError,
        conversationId: null,
      })),
  ]
  return problems.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit)
}

const scheduledLabels: Partial<Record<schema.ScheduledMessage["kind"], string>> = {
  reminder_24h: "recordatorio 24 h",
  reminder_2h: "recordatorio 2 h",
  reactivation: "reactivación",
  waitlist_offer: "lista de espera",
  post_service: "pedido de reseña",
  booking_confirmation: "confirmación de turno",
  booking_cancelled: "aviso de cancelación",
  deposit_request: "pedido de seña",
  hold_expired: "seña vencida",
  deposit_refunded: "devolución de seña",
  waitlist_taken: "lugar ya tomado",
}

export type ConversationRow = {
  id: string
  customerName: string | null
  customerPhone: string
  isTest: boolean
  mode: schema.Conversation["mode"]
  lastMessageAt: Date | null
  preview: string | null
}

/** Últimas conversaciones del negocio (incluye el chat de prueba, marcado). */
export async function recentConversations(scoped: ScopedDb, limit = 30): Promise<ConversationRow[]> {
  const conversations = await scoped.conversations.findMany({
    orderBy: sql`${schema.conversations.lastMessageAt} desc nulls last`,
    limit,
  })
  if (conversations.length === 0) return []
  const customers = await scoped.customers.findMany({
    where: inArray(schema.customers.id, conversations.map((c) => c.customerId)),
  })
  const byId = new Map(customers.map((c) => [c.id, c]))
  return conversations.map((c) => {
    const customer = byId.get(c.customerId)
    return {
      id: c.id,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phoneE164 ?? "",
      isTest: customer?.isTest ?? false,
      mode: c.mode,
      lastMessageAt: c.lastMessageAt,
      preview: c.lastMessagePreview,
    }
  })
}

export type ThreadMessage = {
  id: string
  at: Date
  from: "cliente" | "bot" | "equipo"
  type: schema.Message["type"]
  text: string
  status: schema.Message["status"]
  error: string | null
  tools: { name: string; ok: boolean }[]
  botError: string | null
  rating: "good" | "bad" | null
  ratingNote: string | null
}

/** Una conversación completa con lo que hizo el bot en cada respuesta (herramientas y errores). */
export async function conversationThread(scoped: ScopedDb, conversationId: string, limit = 200) {
  const conversation = await scoped.conversations.findById(conversationId)
  if (!conversation) return null
  const [customer, messages] = await Promise.all([
    scoped.customers.findById(conversation.customerId),
    scoped.messages.findMany({
      where: eq(schema.messages.conversationId, conversation.id),
      orderBy: desc(schema.messages.createdAt),
      limit,
    }),
  ])
  const feedback = messages.length
    ? await scoped.botFeedback.findMany({ where: inArray(schema.botFeedback.messageId, messages.map((m) => m.id)) })
    : []
  const ratingById = new Map(feedback.map((f) => [f.messageId, f]))

  const thread: ThreadMessage[] = messages.reverse().map((m) => {
    const trace = m.toolTrace as MessageTrace | null
    const rating = ratingById.get(m.id)
    return {
      id: m.id,
      at: m.createdAt,
      from: m.direction === "inbound" ? "cliente" : m.sentBy ? "equipo" : "bot",
      type: m.type,
      text: ((m.type === "audio" ? m.transcript : m.body) ?? m.transcript ?? m.body ?? "").trim(),
      status: m.status,
      error: m.error,
      tools: (trace?.tools ?? []).map((t) => ({ name: t.name, ok: t.ok })),
      botError: trace?.error ?? null,
      rating: rating?.rating ?? null,
      ratingNote: rating?.note ?? null,
    }
  })
  return { conversation, customer: customer ?? null, messages: thread }
}

/** Corre la prueba gratis `days` días más, desde hoy o desde su fin si todavía no terminó. Queda en la auditoría. */
export async function extendTrial(db: AnyDb, input: { businessId: string; days: number; actorId: string; now: Date }) {
  const scoped = forBusiness(db, input.businessId)
  const business = await scoped.business()
  if (!business) return null
  const from = business.trialEndsAt && business.trialEndsAt > input.now ? business.trialEndsAt : input.now
  const trialEndsAt = new Date(from.getTime() + input.days * DAY_MS)
  const updated = await scoped.updateBusiness({ trialEndsAt })
  await scoped.auditLogs.insert({
    actorId: input.actorId,
    action: "platform.trial_extended",
    targetType: "business",
    targetId: input.businessId,
    metadata: { days: input.days, from: business.trialEndsAt?.toISOString() ?? null, to: trialEndsAt.toISOString() },
  })
  return updated
}
