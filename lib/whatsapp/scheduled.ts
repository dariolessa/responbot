import { and, asc, eq, lt, lte } from "drizzle-orm"

import { previewOf } from "@/lib/bot/engine"
import { addUsage, usagePeriod } from "@/lib/bot/usage"
import { changeBookingStatus } from "@/lib/booking/create"
import { bookingPayload } from "@/lib/booking/customer-messages"
import { isOpen } from "@/lib/booking/policies"
import { waitlistButtonId } from "@/lib/booking/waitlist"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { fillTemplate, templatePayload, type TemplateName } from "@/lib/integrations/whatsapp/templates"
import { formatMoney } from "@/lib/money"
import { notify } from "@/lib/notifications/dispatch"
import { ensurePaymentLink, type PaymentDeps } from "@/lib/payments/mercadopago"
import { formatZoned, toTimeString } from "@/lib/time"

import { findOrCreateConversation } from "./inbound"
import { isWindowOpen } from "./messages"
import { deliverMessage } from "./outbound"

/*
 * Mensajes programados a clientes (docs/SPEC.md, "Para los clientes finales"):
 * recordatorios, confirmación y cancelación. Los encola lib/booking/
 * customer-messages.ts; acá se mandan cuando vence `send_at` (cron cada 5
 * minutos, o enseguida después de una acción del panel).
 *
 * Dentro de la ventana de 24 horas salen como texto o botones normales; fuera,
 * con la plantilla aprobada. En los dos casos el texto es el de la plantilla y
 * queda en la conversación, así el bot y el equipo ven qué se le mandó.
 */

export const MAX_ATTEMPTS = 3
/** Un recordatorio que no salió a tiempo (Meta caída, cron frenado) ya no sirve después de esto. */
const REMINDER_GRACE_MS = 3 * 3_600_000

export type ScheduledDeps = {
  whatsapp: ((account: schema.WhatsAppAccount) => WhatsAppApi) | null
  /** Para crear el link de la seña la primera vez que se manda. */
  payments?: PaymentDeps | null
}

type Outcome = { status: "sent" | "failed" | "cancelled"; error?: string | null; messageId?: string }

const reminderButtons = [
  { action: "confirm", title: "Confirmo" },
  { action: "reschedule", title: "Reprogramar" },
  { action: "cancel", title: "Cancelar" },
] as const

export type ReminderAction = (typeof reminderButtons)[number]["action"]

export function reminderButtonId(action: ReminderAction, bookingId: string) {
  return `reminder:${action}:${bookingId}`
}

/** "reminder:confirm:<id>" → la acción y el turno; cualquier otra cosa → null. */
export function parseReminderButton(id: string | null | undefined): { action: ReminderAction; bookingId: string } | null {
  const match = /^reminder:(confirm|reschedule|cancel):([0-9a-f-]{36})$/i.exec(id ?? "")
  return match ? { action: match[1] as ReminderAction, bookingId: match[2]!.toLowerCase() } : null
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "qué tal"

/** Plantilla de cada tipo de mensaje programado. */
function messageFor(kind: schema.ScheduledMessage["kind"]): TemplateName | null {
  switch (kind) {
    case "reminder_24h":
      return "recordatorio_turno"
    case "reminder_2h":
      return "recordatorio_corto"
    case "booking_confirmation":
      return "confirmacion_turno"
    case "booking_cancelled":
      return "turno_cancelado"
    case "deposit_request":
      return "sena_pendiente"
    case "hold_expired":
      return "retencion_vencida"
    case "deposit_refunded":
      return "sena_devuelta"
    case "waitlist_offer":
      return "lugar_liberado"
    case "waitlist_taken":
      return "lugar_tomado"
    default:
      return null
  }
}

type MessageData = {
  name: string
  service: string
  staff: string
  day: string
  time: string
  address: string
  deposit: string
  link: string
  holdUntil: string
}

function paramsFor(template: TemplateName, d: MessageData): string[] {
  switch (template) {
    case "recordatorio_turno":
    case "confirmacion_turno":
      return [d.name, d.service, d.staff, d.day, d.time, d.address]
    case "recordatorio_corto":
      return [d.name, d.time, d.service, d.address]
    case "turno_cancelado":
    case "retencion_vencida":
    case "lugar_liberado":
    case "lugar_tomado":
      return [d.name, d.service, d.day, d.time]
    case "sena_pendiente":
      return [d.name, d.service, d.day, d.time, d.deposit, d.link, d.holdUntil]
    case "sena_devuelta":
      return [d.name, d.deposit, d.service, d.day]
    default:
      return []
  }
}

/** Lo que dice el mensaje: el turno, o el horario ofrecido de la lista de espera. */
type Subject = { serviceId: string; resourceId: string; startsAt: Date }

/** ¿Sigue teniendo sentido mandarlo? Devuelve el motivo si no. */
function staleReason(
  kind: schema.ScheduledMessage["kind"],
  booking: schema.Booking | undefined,
  entry: schema.WaitlistEntry | undefined,
  now: Date,
): string | null {
  switch (kind) {
    case "waitlist_offer":
      return entry?.status === "offered" && entry.offeredStartsAt && entry.offeredStartsAt > now
        ? null
        : "La oferta ya no está vigente."
    case "waitlist_taken":
      return entry ? null : "La espera ya no existe."
    case "booking_cancelled":
      return booking?.status === "cancelled" ? null : "El turno ya no está cancelado."
    case "hold_expired":
      return booking?.status === "expired" && booking.startsAt > now ? null : "El turno ya no está vencido."
    case "deposit_refunded":
      return booking?.depositStatus === "refunded" ? null : "La seña no figura devuelta."
    case "deposit_request":
      return booking?.status === "pending_payment" && booking.holdExpiresAt && booking.holdExpiresAt > now
        ? null
        : "El turno ya no espera la seña."
    default:
      return booking && isOpen(booking.status) && booking.startsAt > now ? null : "El turno ya no está vigente."
  }
}

async function sendOne(
  scoped: ScopedDb,
  row: schema.ScheduledMessage,
  deps: ScheduledDeps,
  now: Date,
): Promise<Outcome> {
  const isReminder = row.kind === "reminder_24h" || row.kind === "reminder_2h"
  const booking = row.bookingId ? await scoped.bookings.findById(row.bookingId) : undefined
  const entry = row.waitlistEntryId ? await scoped.waitlistEntries.findById(row.waitlistEntryId) : undefined
  const customer = await scoped.customers.findById(row.customerId)
  if ((!booking && !entry) || !customer || customer.isTest) return { status: "cancelled", error: "El turno ya no existe." }

  const stale = staleReason(row.kind, booking, entry, now)
  if (stale) return { status: "cancelled", error: stale }
  if (isReminder && now.getTime() - row.sendAt.getTime() > REMINDER_GRACE_MS) {
    return { status: "cancelled", error: "No salió a tiempo." }
  }
  if (isReminder && customer.optedOut) {
    return { status: "cancelled", error: "El cliente pidió no recibir recordatorios." }
  }

  const account = await scoped.whatsappAccounts.findFirst(eq(schema.whatsappAccounts.status, "active"))
  if (!account || !deps.whatsapp) return { status: "failed", error: "WhatsApp no está conectado." }

  const subject: Subject | null = booking
    ? booking
    : entry?.offeredStartsAt && entry.offeredResourceId
      ? { serviceId: entry.serviceId, resourceId: entry.offeredResourceId, startsAt: entry.offeredStartsAt }
      : null
  if (!subject) return { status: "cancelled", error: "No hay horario para avisar." }

  let link = ""
  if (row.kind === "deposit_request" && booking) {
    if (!deps.payments) return { status: "failed", error: "Mercado Pago no está configurado." }
    link = await ensurePaymentLink(scoped, booking, deps.payments, now)
  }

  const [business, service, resource] = await Promise.all([
    scoped.business(),
    scoped.services.findById(subject.serviceId),
    scoped.resources.findById(subject.resourceId),
  ])
  const tz = business?.timezone ?? "UTC"
  const data: MessageData = {
    name: firstName(customer.name),
    service: service?.name ?? "tu turno",
    staff: resource?.name ?? "el equipo",
    day: formatZoned(subject.startsAt, tz, "EEEE d 'de' MMMM"),
    time: toTimeString(subject.startsAt, tz),
    address: business?.address || business?.name || "el local",
    deposit: booking ? formatMoney(booking.depositAmount, booking.currency) : "",
    link,
    holdUntil: booking?.holdExpiresAt ? toTimeString(booking.holdExpiresAt, tz) : "",
  }
  const template = messageFor(row.kind)
  if (!template) return { status: "cancelled", error: "Tipo de mensaje que todavía no se manda." }
  const params = paramsFor(template, data)
  const body = fillTemplate(template, params)
  const buttons =
    row.kind === "reminder_24h" && booking
      ? reminderButtons.map((b) => ({ id: reminderButtonId(b.action, booking.id), title: b.title }))
      : row.kind === "waitlist_offer" && entry
        ? [{ id: waitlistButtonId(entry.id), title: "Lo quiero" }]
        : []

  const { conversation } = await findOrCreateConversation(scoped, customer.phoneE164, customer.name)
  const windowOpen = isWindowOpen(conversation.lastInboundAt, now)

  const [message] = await scoped.messages.insert({
    conversationId: conversation.id,
    direction: "outbound",
    type: windowOpen ? (buttons.length ? "interactive" : "text") : "template",
    body,
    choices: buttons.length ? { options: buttons } : null,
    status: "queued",
    createdAt: now,
  })
  await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
    lastMessageAt: now,
    lastMessagePreview: previewOf(message!),
  })

  const sent = await deliverMessage(
    scoped,
    deps.whatsapp(account),
    customer.phoneE164,
    message!,
    windowOpen
      ? undefined
      : { type: "template", template: templatePayload(template, params, buttons.map((b) => b.id)) },
  )
  if (sent.status === "failed") return { status: "failed", error: sent.error, messageId: sent.id }
  if (!windowOpen) await addUsage(scoped, usagePeriod(now, tz), { templatesSent: 1 })

  // "Cliente no confirmó a 2 horas del turno": se le pidió confirmar y no contestó.
  if (row.kind === "reminder_2h" && booking && booking.status === "confirmed") {
    const asked = await scoped.scheduledMessages.findFirst(
      and(
        eq(schema.scheduledMessages.bookingId, booking.id),
        eq(schema.scheduledMessages.kind, "reminder_24h"),
        eq(schema.scheduledMessages.status, "sent"),
      ),
    )
    if (asked) {
      await notify(scoped, {
        type: "booking.unconfirmed",
        payload: await bookingPayload(scoped, booking, tz),
        resourceId: booking.resourceId,
        now,
      })
    }
  }
  return { status: "sent", messageId: sent.id }
}

/** Manda los mensajes programados vencidos del negocio. */
export async function sendDueCustomerMessages(
  scoped: ScopedDb,
  deps: ScheduledDeps,
  now: Date = new Date(),
  limit = 50,
): Promise<{ sent: number; failed: number; cancelled: number }> {
  const due = await scoped.scheduledMessages.findMany({
    where: and(
      eq(schema.scheduledMessages.status, "pending"),
      lte(schema.scheduledMessages.sendAt, now),
      lt(schema.scheduledMessages.attempts, MAX_ATTEMPTS),
    ),
    orderBy: asc(schema.scheduledMessages.sendAt),
    limit,
  })
  const totals = { sent: 0, failed: 0, cancelled: 0 }
  for (const row of due) {
    // Se toma la fila sumando un intento; si otro proceso ya la tomó, no coincide y se saltea.
    const [claimed] = await scoped.scheduledMessages.update(
      and(
        eq(schema.scheduledMessages.id, row.id),
        eq(schema.scheduledMessages.status, "pending"),
        eq(schema.scheduledMessages.attempts, row.attempts),
      ),
      { attempts: row.attempts + 1 },
    )
    if (!claimed) continue
    let outcome: Outcome
    try {
      outcome = await sendOne(scoped, claimed, deps, now)
    } catch (error) {
      console.error("[recordatorios] falló un envío", row.kind, error)
      // Error inesperado: se reintenta en la próxima vuelta hasta MAX_ATTEMPTS.
      const last = claimed.attempts >= MAX_ATTEMPTS
      await scoped.scheduledMessages.update(eq(schema.scheduledMessages.id, row.id), {
        status: last ? "failed" : "pending",
        lastError: "No se pudo mandar.",
      })
      if (last) totals.failed++
      continue
    }
    await scoped.scheduledMessages.update(eq(schema.scheduledMessages.id, row.id), {
      status: outcome.status,
      lastError: outcome.error ?? null,
      messageId: outcome.messageId ?? null,
    })
    totals[outcome.status]++
  }
  return totals
}

/**
 * El cliente tocó un botón de un recordatorio. "Confirmo" pasa el turno a
 * confirmado por el cliente y responde sin IA; "Reprogramar" y "Cancelar" le
 * llegan al bot como pedido sobre ese turno, que lo resuelve con sus
 * herramientas y la política de cancelación.
 */
export async function reminderReply(
  scoped: ScopedDb,
  customer: schema.Customer,
  button: { action: ReminderAction; bookingId: string },
  title: string,
  now: Date,
): Promise<{ text: string; autoReply?: string }> {
  const booking = await scoped.bookings.findFirst(
    and(eq(schema.bookings.id, button.bookingId), eq(schema.bookings.customerId, customer.id)),
  )
  if (!booking || !isOpen(booking.status) || booking.startsAt <= now) {
    return { text: `${title} (tocó el botón de un recordatorio de un turno que ya no está vigente)` }
  }
  const business = await scoped.business()
  const tz = business?.timezone ?? "UTC"
  const service = await scoped.services.findById(booking.serviceId)
  const when = `${formatZoned(booking.startsAt, tz, "EEEE d 'de' MMMM")} a las ${toTimeString(booking.startsAt, tz)}`

  if (button.action === "confirm" && booking.status !== "pending_payment") {
    if (booking.status === "confirmed") {
      await changeBookingStatus(
        scoped,
        { bookingId: booking.id, to: "client_confirmed" },
        { type: "customer", id: customer.id, channel: "whatsapp" },
        { now },
      )
    }
    return { text: title, autoReply: `¡Gracias por confirmar! Te esperamos el ${when}.` }
  }
  const verb = button.action === "cancel" ? "cancelar" : button.action === "reschedule" ? "reprogramar" : "confirmar"
  return { text: `Quiero ${verb} mi turno de ${service?.name ?? "mañana"} del ${when}.` }
}
