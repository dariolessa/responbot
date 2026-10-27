import { and, desc, eq, inArray, sql } from "drizzle-orm"

import type { MessageTrace } from "@/lib/bot/engine"
import { ratingsFor, type BotRating } from "@/lib/bot/feedback"
import {
  agendaAccess,
  conversationsVisibleWhere,
  realConversationsWhere,
  type AgendaAccess,
} from "@/lib/booking/access"
import type { Tenant } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatPhone } from "@/lib/phone"

import { isWindowOpen } from "./messages"

/*
 * Datos de la bandeja de conversaciones (/app/conversaciones): la lista con
 * el filtro "necesita humano" y el hilo de cada cliente.
 */

type InboxTenant = Pick<Tenant, "role" | "user"> & { db: ScopedDb }

export type InboxFilter = "all" | "human"

export type InboxItem = {
  id: string
  customerName: string
  phone: string
  preview: string
  lastMessageAt: string | null
  unread: number
  mode: "bot" | "human"
  assignedName: string | null
  assignedToMe: boolean
}

const INBOX_LIMIT = 100

function displayName(customer: Pick<schema.Customer, "name" | "phoneE164"> | undefined) {
  if (!customer) return "Cliente"
  return customer.name?.trim() || formatPhone(customer.phoneE164)
}

export async function listInbox(tenant: InboxTenant, filter: InboxFilter): Promise<InboxItem[]> {
  const access = await agendaAccess(tenant)
  const rows = await tenant.db.conversations.findMany({
    where: and(
      realConversationsWhere(),
      conversationsVisibleWhere(access, tenant.user.id),
      filter === "human" ? eq(schema.conversations.mode, "human") : undefined,
    ),
    orderBy: [sql`${schema.conversations.lastMessageAt} desc nulls last`, desc(schema.conversations.createdAt)],
    limit: INBOX_LIMIT,
  })
  if (rows.length === 0) return []

  const [customers, members] = await Promise.all([
    tenant.db.customers.findMany({ where: inArray(schema.customers.id, rows.map((r) => r.customerId)) }),
    tenant.db.members(),
  ])
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const memberName = new Map(members.map((m) => [m.userId, m.name ?? m.email]))

  return rows.map((r) => {
    const customer = customerById.get(r.customerId)
    return {
      id: r.id,
      customerName: displayName(customer),
      phone: customer ? formatPhone(customer.phoneE164) : "",
      preview: r.lastMessagePreview ?? "",
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      unread: r.unreadCount,
      mode: r.mode,
      assignedName: r.assignedTo ? (memberName.get(r.assignedTo) ?? null) : null,
      assignedToMe: r.assignedTo === tenant.user.id,
    }
  })
}

export type ThreadMessage = {
  id: string
  direction: "inbound" | "outbound"
  type: schema.Message["type"]
  /** Lo que se muestra: el texto, o la transcripción del audio. */
  body: string
  /** Para audios e imágenes: la transcripción o la descripción que leyó el bot. */
  transcript: string | null
  at: string
  status: schema.Message["status"]
  error: string | null
  choices: string[]
  /** Foto que mandó el bot (ficha del catálogo); las del cliente no se guardan. */
  imageUrl: string | null
  /** "bot", el nombre de quien respondió desde el panel, o null si es del cliente. */
  author: string | null
  /** Opinión del equipo sobre una respuesta del bot. */
  rating: { value: BotRating; note: string | null } | null
}

export type Thread = {
  id: string
  customerId: string
  customerName: string
  phone: string
  mode: "bot" | "human"
  assignedName: string | null
  assignedToMe: boolean
  windowOpen: boolean
  messages: ThreadMessage[]
}

const THREAD_LIMIT = 200

export async function canSeeConversation(scoped: ScopedDb, access: AgendaAccess, userId: string, id: string) {
  const row = await scoped.conversations.findFirst(
    and(eq(schema.conversations.id, id), realConversationsWhere(), conversationsVisibleWhere(access, userId)),
  )
  return row ?? null
}

export async function loadThread(tenant: InboxTenant, conversationId: string, now = new Date()): Promise<Thread | null> {
  const access = await agendaAccess(tenant)
  const conversation = await canSeeConversation(tenant.db, access, tenant.user.id, conversationId)
  if (!conversation) return null

  const [customer, recent, members] = await Promise.all([
    tenant.db.customers.findById(conversation.customerId),
    tenant.db.messages.findMany({
      where: eq(schema.messages.conversationId, conversation.id),
      orderBy: [desc(schema.messages.createdAt), desc(schema.messages.id)],
      limit: THREAD_LIMIT,
    }),
    tenant.db.members(),
  ])
  const memberName = new Map(members.map((m) => [m.userId, m.name ?? m.email ?? "Equipo"]))
  const ratings = await ratingsFor(
    tenant.db,
    recent.filter((m) => m.direction === "outbound" && !m.sentBy).map((m) => m.id),
  )

  const messages = recent.reverse().map((m): ThreadMessage => {
    const trace = m.toolTrace as MessageTrace | null
    const media = m.type === "audio" || m.type === "image"
    return {
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: (m.type === "audio" ? m.transcript : m.body) ?? "",
      transcript: media ? m.transcript : null,
      at: m.createdAt.toISOString(),
      status: m.status,
      error: m.error ?? (trace?.error ? "El bot no pudo responder bien este mensaje." : null),
      choices: m.choices?.options.map((o) => o.title) ?? [],
      imageUrl: m.direction === "outbound" ? m.mediaUrl : null,
      author:
        m.direction === "inbound" ? null : m.sentBy ? (memberName.get(m.sentBy) ?? "Equipo") : "bot",
      rating: ratings.has(m.id) ? { value: ratings.get(m.id)!.rating, note: ratings.get(m.id)!.note } : null,
    }
  })

  return {
    id: conversation.id,
    customerId: conversation.customerId,
    customerName: displayName(customer),
    phone: customer ? formatPhone(customer.phoneE164) : "",
    mode: conversation.mode,
    assignedName: conversation.assignedTo ? (memberName.get(conversation.assignedTo) ?? null) : null,
    assignedToMe: conversation.assignedTo === tenant.user.id,
    windowOpen: isWindowOpen(conversation.lastInboundAt, now),
    messages,
  }
}
