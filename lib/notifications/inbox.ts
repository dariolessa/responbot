import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

import { effectivePrefs } from "./dispatch"
import {
  notificationTypeList,
  notificationTypes,
  renderNotification,
  type Channel,
  type NotificationPayloads,
  type NotificationType,
} from "./types"

/*
 * Bandeja de avisos del panel y preferencias por canal (/app/notificaciones).
 * Cada persona ve solo sus avisos del negocio activo.
 */

const inAppWhere = (userId: string) =>
  and(eq(schema.notifications.userId, userId), sql`'in_app' = any(${schema.notifications.channels})`)

export type InboxItem = {
  id: string
  title: string
  body: string
  url: string
  read: boolean
  createdAt: Date
}

export async function listNotifications(scoped: ScopedDb, userId: string, limit = 50): Promise<InboxItem[]> {
  const rows = await scoped.notifications.findMany({
    where: inAppWhere(userId),
    orderBy: desc(schema.notifications.createdAt),
    limit,
  })
  return rows.map((row) => {
    const rendered = renderNotification(row.type as NotificationType, row.payload as NotificationPayloads[NotificationType])
    return { id: row.id, ...rendered, read: Boolean(row.readAt), createdAt: row.createdAt }
  })
}

export function unreadCount(scoped: ScopedDb, userId: string): Promise<number> {
  return scoped.notifications.count(and(inAppWhere(userId), isNull(schema.notifications.readAt)))
}

/** Marca un aviso como leído y devuelve a dónde lleva (o null si no es de esta persona). */
export async function openNotification(scoped: ScopedDb, userId: string, id: string, now = new Date()) {
  const row = await scoped.notifications.findFirst(
    and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)),
  )
  if (!row) return null
  if (!row.readAt) await scoped.notifications.update(eq(schema.notifications.id, id), { readAt: now })
  return renderNotification(row.type as NotificationType, row.payload as NotificationPayloads[NotificationType]).url
}

export async function markAllRead(scoped: ScopedDb, userId: string, now = new Date()) {
  await scoped.notifications.update(and(inAppWhere(userId), isNull(schema.notifications.readAt)), { readAt: now })
}

/** Tipos que le llegan a cada rol (un profesional solo recibe los de sus turnos). */
export function typesForRole(role: schema.Role): NotificationType[] {
  return notificationTypeList.filter((type) => {
    const def = notificationTypes[type]
    if (def.ownerOnly) return role === "owner"
    return role !== "staff" || def.forStaff
  })
}

export type PrefsForm = {
  types: Record<string, Record<Channel, boolean>>
  quietStart: string
  quietEnd: string
}

export async function loadPrefs(scoped: ScopedDb, userId: string, role: schema.Role): Promise<PrefsForm> {
  const saved = await scoped.notificationPrefs.findMany({ where: eq(schema.notificationPrefs.userId, userId) })
  const byType = new Map(saved.map((p) => [p.type, p]))
  const types: PrefsForm["types"] = {}
  let quiet: { quietStart: string; quietEnd: string } | null = null
  for (const type of typesForRole(role)) {
    const prefs = effectivePrefs(type, role, byType.get(type))
    types[type] = { in_app: prefs.in_app, push: prefs.push, whatsapp: prefs.whatsapp, email: prefs.email }
    quiet ??= byType.has(type) ? { quietStart: prefs.quietStart, quietEnd: prefs.quietEnd } : null
  }
  return { types, quietStart: quiet?.quietStart ?? "22:00", quietEnd: quiet?.quietEnd ?? "08:00" }
}

/**
 * Guarda las preferencias de los tipos que vienen (la pantalla manda todos).
 * Las horas de silencio son de la persona: valen para todos sus tipos.
 */
export async function savePrefs(scoped: ScopedDb, userId: string, role: schema.Role, input: PrefsForm) {
  const types = typesForRole(role).filter((type) => input.types[type])
  const rows = types.map((type) => {
    const def = notificationTypes[type]
    const chosen = input.types[type]!
    const on = (channel: Channel) => def.channels.includes(channel) && Boolean(chosen[channel])
    return {
      userId,
      type,
      inApp: on("in_app"),
      push: on("push"),
      whatsapp: on("whatsapp"),
      email: on("email"),
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
    }
  })
  const mine = eq(schema.notificationPrefs.userId, userId)
  await scoped.transaction(async (tx) => {
    if (types.length) await tx.notificationPrefs.delete(and(mine, inArray(schema.notificationPrefs.type, types)))
    await tx.notificationPrefs.insert(rows)
    await tx.notificationPrefs.update(mine, { quietStart: input.quietStart, quietEnd: input.quietEnd })
  })
}
