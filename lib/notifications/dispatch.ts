import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"

import { notificationEmail } from "@/emails/notification"
import type { RenderedEmail } from "@/emails/render"
import { addUsage, usagePeriod } from "@/lib/bot/usage"
import * as schema from "@/lib/db/schema"
import type { MemberWithUser, ScopedDb, TenantInsert } from "@/lib/db/scoped"
import type { WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { GraphError } from "@/lib/integrations/whatsapp/graph"
import { templatePayload, type TemplateName } from "@/lib/integrations/whatsapp/templates"
import { minutesOfDay } from "@/lib/time"

import {
  isQuietTime,
  notificationTypes,
  renderNotification,
  type Channel,
  type NotificationPayloads,
  type NotificationType,
} from "./types"

/*
 * Despachador único de avisos al equipo (docs/SPEC.md, "Notificaciones").
 *
 * 1. `notify` recibe un evento, decide los destinatarios según rol y
 *    preferencias, y deja una fila en `notifications` por persona con los
 *    canales elegidos. Los canales externos quedan "pending" en sent_status.
 *    Es solo base de datos: corre dentro de la misma transacción que el
 *    cambio que lo provoca (si el turno no se guarda, no hay aviso).
 * 2. `deliverPendingNotifications` manda push, WhatsApp y correo de las filas
 *    pendientes y guarda el resultado por canal. Lo llaman las acciones del
 *    panel después de responder (after) y el cron de cada 5 minutos.
 */

export type PushMessage = { title: string; body: string; url: string; tag: string }

export type PushSender = {
  /** "gone" si el navegador dio de baja la suscripción (404/410): se borra. */
  send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    message: PushMessage,
  ): Promise<"sent" | "gone">
}

export type EmailSender = { send(input: RenderedEmail & { to: string }): Promise<void> }

/** Canales reales; los tests pasan simulaciones. null = no configurado (el canal queda "skipped"). */
export type DeliveryDeps = {
  push: PushSender | null
  email: EmailSender | null
  /** Cloud API para la cuenta de WhatsApp del negocio. */
  whatsapp: ((account: schema.WhatsAppAccount) => WhatsAppApi) | null
  /** Origen público de la app, para los enlaces. */
  appUrl: string
}

type DeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped"

const DEFAULT_QUIET_START = "22:00"
const DEFAULT_QUIET_END = "08:00"

export type NotifyInput<T extends NotificationType> = {
  type: T
  payload: NotificationPayloads[T]
  /** Profesional del turno: si tiene cuenta, recibe los eventos de sus turnos. */
  resourceId?: string | null
  /** Quien provocó el evento no se avisa a sí mismo. */
  excludeUserId?: string | null
  /** Solo la bandeja del panel (por ejemplo, el chat de prueba). */
  inAppOnly?: boolean
  /** Solo estas personas (por ejemplo, el resumen diario a una persona). */
  userIds?: string[]
  now?: Date
}

/** Preferencias guardadas de un tipo, o las de fábrica para su rol. */
export function effectivePrefs(
  type: NotificationType,
  role: schema.Role,
  saved: Pick<schema.NotificationPrefs, "inApp" | "push" | "whatsapp" | "email" | "quietStart" | "quietEnd"> | undefined,
) {
  const def = notificationTypes[type]
  const defaults = def.defaults(role)
  const pick = (channel: Channel, value: boolean | undefined) =>
    def.channels.includes(channel) && (value ?? defaults[channel])
  return {
    in_app: pick("in_app", saved?.inApp),
    push: pick("push", saved?.push),
    whatsapp: pick("whatsapp", saved?.whatsapp),
    email: pick("email", saved?.email),
    quietStart: saved?.quietStart?.slice(0, 5) ?? DEFAULT_QUIET_START,
    quietEnd: saved?.quietEnd?.slice(0, 5) ?? DEFAULT_QUIET_END,
  }
}

async function recipientsFor(
  scoped: ScopedDb,
  input: NotifyInput<NotificationType>,
): Promise<MemberWithUser[]> {
  const def = notificationTypes[input.type]
  const members = (await scoped.members()).filter((m) => m.active)
  let staffUserId: string | null = null
  if (def.forStaff && input.resourceId) {
    const resource = await scoped.resources.findById(input.resourceId)
    staffUserId = resource?.userId ?? null
  }
  return members.filter((m) => {
    if (input.excludeUserId && m.userId === input.excludeUserId) return false
    if (input.userIds && !input.userIds.includes(m.userId)) return false
    if (def.ownerOnly) return m.role === "owner"
    if (m.role === "owner" || m.role === "admin") return true
    return m.userId === staffUserId
  })
}

/** Crea los avisos de un evento. Devuelve las filas creadas (una por destinatario con algún canal). */
export async function notify<T extends NotificationType>(
  scoped: ScopedDb,
  input: NotifyInput<T>,
): Promise<schema.Notification[]> {
  const now = input.now ?? new Date()
  const def = notificationTypes[input.type]
  const recipients = await recipientsFor(scoped, input as NotifyInput<NotificationType>)
  if (recipients.length === 0) return []

  const [business, saved] = await Promise.all([
    scoped.business(),
    scoped.notificationPrefs.findMany({
      where: and(
        eq(schema.notificationPrefs.type, input.type),
        inArray(
          schema.notificationPrefs.userId,
          recipients.map((r) => r.userId),
        ),
      ),
    }),
  ])
  const prefsByUser = new Map(saved.map((p) => [p.userId, p]))
  const minute = minutesOfDay(now, business?.timezone ?? "UTC")

  const rows: TenantInsert<typeof schema.notifications>[] = []
  for (const member of recipients) {
    const prefs = effectivePrefs(input.type, member.role, prefsByUser.get(member.userId))
    const quiet = !def.ignoresQuietHours && isQuietTime(minute, prefs.quietStart, prefs.quietEnd)
    const chosen: Channel[] = []
    if (prefs.in_app) chosen.push("in_app")
    if (!input.inAppOnly) {
      if (prefs.push && !quiet) chosen.push("push")
      if (prefs.whatsapp && !quiet && member.phoneE164) chosen.push("whatsapp")
      if (prefs.email && member.email && !member.emailBouncedAt) chosen.push("email")
    }
    if (chosen.length === 0) continue
    const sentStatus: Record<string, DeliveryStatus> = {}
    for (const channel of chosen) if (channel !== "in_app") sentStatus[channel] = "pending"
    rows.push({
      userId: member.userId,
      type: input.type,
      payload: input.payload,
      channels: chosen,
      sentStatus,
      createdAt: now,
    })
  }
  return scoped.notifications.insert(rows)
}

// ---------------------------------------------------------------------------
// Entrega por canal
// ---------------------------------------------------------------------------

/** Plantilla de WhatsApp para un aviso al equipo, o null si ese tipo no va por WhatsApp. */
export function ownerTemplate(
  type: NotificationType,
  payload: NotificationPayloads[NotificationType],
  person: string,
  businessName: string,
): { name: TemplateName; params: string[] } | null {
  switch (type) {
    case "conversation.handoff": {
      const p = payload as NotificationPayloads["conversation.handoff"]
      return { name: "aviso_derivacion_dueno", params: [person, p.customerName ?? "Un cliente", p.reason] }
    }
    case "summary.daily": {
      const p = payload as NotificationPayloads["summary.daily"]
      return {
        name: "resumen_diario_dueno",
        params: [person, businessName, String(p.bookings), p.firstTime ?? "-", String(p.botBookings)],
      }
    }
    case "booking.created": {
      const p = payload as NotificationPayloads["booking.created"]
      return {
        name: "aviso_reserva_dueno",
        params: [person, businessName, p.customerName, p.serviceName, p.staffName, p.day, p.time],
      }
    }
    case "booking.changed": {
      const p = payload as NotificationPayloads["booking.changed"]
      return {
        name: "aviso_cambio_turno_dueno",
        params: [
          person,
          businessName,
          p.change === "cancelled" ? "se canceló" : "se reprogramó",
          p.customerName,
          p.serviceName,
          p.staffName,
          p.day,
          p.time,
        ],
      }
    }
    default:
      return null
  }
}

const emailButtonLabels: Partial<Record<NotificationType, string>> = {
  "whatsapp.disconnected": "Reconectar WhatsApp",
  "mercadopago.disconnected": "Reconectar Mercado Pago",
  "summary.daily": "Ver la agenda",
  "summary.weekly": "Ver estadísticas",
  "billing.payment_failed": "Actualizar la tarjeta",
  "billing.usage": "Ver planes",
}

function emailLines(type: NotificationType, payload: NotificationPayloads[NotificationType]): string[] {
  if (type === "summary.weekly") {
    const p = payload as NotificationPayloads["summary.weekly"]
    return [
      `Turnos: ${p.bookings}`,
      `Atendidos: ${p.completed}`,
      `Inasistencias: ${p.noShows}`,
      `Ingresos estimados: ${p.revenue}`,
      `Reservas que tomó el bot: ${p.botBookings}`,
    ]
  }
  return []
}

async function claim(scoped: ScopedDb, row: schema.Notification): Promise<Record<string, DeliveryStatus> | null> {
  const next: Record<string, DeliveryStatus> = {}
  for (const [channel, status] of Object.entries(row.sentStatus)) {
    next[channel] = status === "pending" ? "sending" : (status as DeliveryStatus)
  }
  // Solo si nadie la tomó mientras tanto (el cron y el after pueden coincidir).
  const [claimed] = await scoped.notifications.update(
    and(eq(schema.notifications.id, row.id), sql`${schema.notifications.sentStatus} = ${JSON.stringify(row.sentStatus)}::jsonb`),
    { sentStatus: next },
  )
  return claimed ? next : null
}

/** Manda los canales pendientes de los avisos del negocio (de las últimas 24 horas). */
export async function deliverPendingNotifications(
  scoped: ScopedDb,
  deps: DeliveryDeps,
  now: Date = new Date(),
  limit = 50,
): Promise<{ delivered: number }> {
  const pending = await scoped.notifications.findMany({
    where: and(
      gt(schema.notifications.createdAt, new Date(now.getTime() - 86_400_000)),
      sql`exists (select 1 from jsonb_each_text(${schema.notifications.sentStatus}) s where s.value = 'pending')`,
    ),
    orderBy: desc(schema.notifications.createdAt),
    limit,
  })
  if (pending.length === 0) return { delivered: 0 }

  const [business, members, account] = await Promise.all([
    scoped.business(),
    scoped.members(),
    scoped.whatsappAccounts.findFirst(eq(schema.whatsappAccounts.status, "active")),
  ])
  const memberById = new Map(members.map((m) => [m.userId, m]))
  const businessName = business?.name ?? ""
  let delivered = 0

  for (const row of pending) {
    const status = await claim(scoped, row)
    if (!status) continue
    const member = memberById.get(row.userId)
    const type = row.type as NotificationType
    const payload = row.payload as NotificationPayloads[NotificationType]
    const rendered = renderNotification(type, payload)
    const person = member?.name?.split(" ")[0] || "equipo"

    for (const channel of Object.keys(status)) {
      if (status[channel] !== "sending") continue
      try {
        if (!member || !member.active) {
          status[channel] = "skipped"
        } else if (channel === "push") {
          status[channel] = await sendPush(scoped, deps, member.userId, rendered, row.id)
        } else if (channel === "whatsapp") {
          const template = ownerTemplate(type, payload, person, businessName)
          if (!deps.whatsapp || !account || !member.phoneE164 || !template) {
            status[channel] = "skipped"
          } else {
            await deps.whatsapp(account).send(member.phoneE164, {
              type: "template",
              template: templatePayload(template.name, template.params),
            })
            await addUsage(scoped, usagePeriod(now, business?.timezone ?? "UTC"), { templatesSent: 1 })
            status[channel] = "sent"
          }
        } else if (channel === "email") {
          if (!deps.email || !member.email || member.emailBouncedAt) {
            status[channel] = "skipped"
          } else {
            const email = await notificationEmail(`${rendered.title} · ${businessName}`, {
              businessName,
              title: rendered.title,
              body: rendered.body,
              button: { label: emailButtonLabels[type] ?? "Abrir el panel", url: `${deps.appUrl}${rendered.url}` },
              preferencesUrl: `${deps.appUrl}/app/notificaciones`,
              lines: emailLines(type, payload),
            })
            await deps.email.send({ to: member.email, ...email })
            status[channel] = "sent"
          }
        } else {
          status[channel] = "skipped"
        }
      } catch (error) {
        console.error("[avisos] no se pudo entregar", channel, row.type, error instanceof Error ? error.message : error)
        status[channel] = "failed"
        if (channel === "whatsapp" && error instanceof GraphError && error.tokenInvalid && account) {
          await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, account.id), { status: "token_expired" })
        }
      }
    }
    await scoped.notifications.update(eq(schema.notifications.id, row.id), { sentStatus: status })
    delivered++
  }
  return { delivered }
}

async function sendPush(
  scoped: ScopedDb,
  deps: DeliveryDeps,
  userId: string,
  rendered: { title: string; body: string; url: string },
  tag: string,
): Promise<DeliveryStatus> {
  if (!deps.push) return "skipped"
  const subscriptions = await scoped.memberPushSubscriptions(userId)
  if (subscriptions.length === 0) return "skipped"
  let sent = 0
  for (const subscription of subscriptions) {
    try {
      const result = await deps.push.send(subscription, { ...rendered, tag })
      if (result === "gone") await scoped.deleteMemberPushSubscription(userId, subscription.endpoint)
      else sent++
    } catch (error) {
      console.error("[avisos] push falló", error instanceof Error ? error.message : error)
    }
  }
  return sent > 0 ? "sent" : "failed"
}
