import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte } from "drizzle-orm"

import { billingState, hasFeature } from "@/lib/billing/state"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

import { openStatuses } from "./policies"

/*
 * Mensajes al cliente que no dependen de un cambio de agenda puntual
 * (docs/SPEC.md, "Recordatorios y reactivación" y "Después del servicio"):
 *
 * - Reactivación: quien pasó su intervalo habitual entre visitas (o el del
 *   servicio) sin turno nuevo recibe una propuesta con su profesional de
 *   siempre. Una por visita y como mucho una cada 30 días. Plan Equipo.
 * - Pedido de reseña: al marcar un turno atendido, si el negocio lo prendió
 *   y cargó el enlace; como mucho uno cada 90 días por cliente.
 *
 * Acá solo se encolan en `scheduled_messages`; los manda
 * lib/whatsapp/scheduled.ts como el resto.
 */

const DAY_MS = 86_400_000
export const REACTIVATION_MIN_GAP_DAYS = 30
export const REVIEW_MIN_GAP_DAYS = 90
/** Un turno marcado atendido mucho después ya no amerita pedir la reseña. */
const REVIEW_MAX_LATE_MS = 3 * DAY_MS
/** Cuántas reactivaciones encola un negocio por día (cuidan el gasto en plantillas). */
export const REACTIVATIONS_PER_DAY = 30

export type ReactivationButton = { answer: "yes" | "no"; customerId: string }

export function reactivationButtonId(answer: ReactivationButton["answer"], customerId: string) {
  return `reactivation:${answer}:${customerId}`
}

export function parseReactivationButton(id: string | null | undefined): ReactivationButton | null {
  const match = /^reactivation:(yes|no):([0-9a-f-]{36})$/i.exec(id ?? "")
  return match ? { answer: match[1] as ReactivationButton["answer"], customerId: match[2]!.toLowerCase() } : null
}

/** Último turno atendido del cliente: de ahí salen el servicio y el profesional habitual. */
export function lastCompletedBooking(scoped: ScopedDb, customerId: string) {
  return scoped.bookings.findFirst(
    and(eq(schema.bookings.customerId, customerId), eq(schema.bookings.status, "completed")),
    [desc(schema.bookings.startsAt)],
  )
}

export function hasUpcomingBooking(scoped: ScopedDb, customerId: string, now: Date) {
  return scoped.bookings
    .count(
      and(
        eq(schema.bookings.customerId, customerId),
        inArray(schema.bookings.status, [...openStatuses]),
        gt(schema.bookings.startsAt, now),
      ),
    )
    .then((n) => n > 0)
}

/** Días después de la última visita en que corresponde invitar a volver; null si no hay con qué calcularlo. */
export function reactivationDueAt(
  customer: Pick<schema.Customer, "lastVisitAt" | "avgIntervalDays">,
  service: Pick<schema.Service, "rebookIntervalDays"> | undefined,
): Date | null {
  const interval = service?.rebookIntervalDays ?? customer.avgIntervalDays
  if (!customer.lastVisitAt || !interval) return null
  return new Date(customer.lastVisitAt.getTime() + interval * DAY_MS)
}

/** Encola las reactivaciones que vencieron. Devuelve cuántas. */
export async function queueReactivations(scoped: ScopedDb, now: Date, limit = REACTIVATIONS_PER_DAY): Promise<number> {
  const business = await scoped.business()
  if (!business) return 0
  const billing = billingState(business, now)
  if (!billing.canBook || !hasFeature(billing, "reactivation")) return 0
  const settings = await scoped.botSettings.findFirst()
  if (settings && !settings.reactivationEnabled) return 0
  const whatsapp = await scoped.whatsappAccounts.findFirst(eq(schema.whatsappAccounts.status, "active"))
  if (!whatsapp) return 0

  // Ningún servicio se repite antes de una semana: los que vinieron hace menos ni se miran.
  const candidates = await scoped.customers.findMany({
    where: and(
      eq(schema.customers.isTest, false),
      eq(schema.customers.optedOut, false),
      isNotNull(schema.customers.lastVisitAt),
      lte(schema.customers.lastVisitAt, new Date(now.getTime() - 7 * DAY_MS)),
    ),
    orderBy: asc(schema.customers.lastVisitAt),
    limit: 500,
  })

  let queued = 0
  for (const customer of candidates) {
    if (queued >= limit) break
    const last = await lastCompletedBooking(scoped, customer.id)
    if (!last) continue
    const service = await scoped.services.findById(last.serviceId)
    const due = reactivationDueAt(customer, service)
    if (!due || due > now) continue
    // Una por visita, y como mucho una cada 30 días (las pendientes cuentan).
    const since = new Date(Math.min(customer.lastVisitAt!.getTime(), now.getTime() - REACTIVATION_MIN_GAP_DAYS * DAY_MS))
    const already = await scoped.scheduledMessages.count(
      and(
        eq(schema.scheduledMessages.customerId, customer.id),
        eq(schema.scheduledMessages.kind, "reactivation"),
        inArray(schema.scheduledMessages.status, ["pending", "sent"]),
        gte(schema.scheduledMessages.createdAt, since),
      ),
    )
    if (already > 0) continue
    if (await hasUpcomingBooking(scoped, customer.id, now)) continue
    await scoped.scheduledMessages.insert({ customerId: customer.id, kind: "reactivation", sendAt: now })
    queued++
  }
  return queued
}

/** Al marcar un turno atendido: encola el pedido de reseña si corresponde. */
export async function queueReviewRequest(scoped: ScopedDb, booking: schema.Booking, now: Date): Promise<boolean> {
  const settings = await scoped.botSettings.findFirst()
  if (!settings?.reviewRequestEnabled || !settings.reviewUrl) return false
  if (now.getTime() - booking.endsAt.getTime() > REVIEW_MAX_LATE_MS) return false
  const customer = await scoped.customers.findById(booking.customerId)
  if (!customer || customer.isTest || customer.optedOut) return false
  const recent = await scoped.scheduledMessages.count(
    and(
      eq(schema.scheduledMessages.customerId, customer.id),
      eq(schema.scheduledMessages.kind, "post_service"),
      inArray(schema.scheduledMessages.status, ["pending", "sent"]),
      gte(schema.scheduledMessages.createdAt, new Date(now.getTime() - REVIEW_MIN_GAP_DAYS * DAY_MS)),
    ),
  )
  if (recent > 0) return false
  const from = Math.max(now.getTime(), booking.endsAt.getTime())
  await scoped.scheduledMessages.insert({
    bookingId: booking.id,
    customerId: customer.id,
    kind: "post_service",
    sendAt: new Date(from + settings.reviewDelayHours * 3_600_000),
  })
  return true
}

export const REACTIVATION_DECLINED_REPLY = "¡Dale! Cuando quieras volver, escribinos por acá y te buscamos un horario."

/**
 * El cliente tocó un botón de la reactivación. "Sí, quiero" le llega al bot
 * como pedido de turno con su servicio y profesional de siempre; "Ahora no"
 * responde un texto fijo, sin IA.
 */
export async function reactivationReply(
  scoped: ScopedDb,
  customer: schema.Customer,
  button: ReactivationButton,
  title: string,
): Promise<{ text: string; autoReply?: string }> {
  if (button.customerId !== customer.id) return { text: title }
  if (button.answer === "no") return { text: title, autoReply: REACTIVATION_DECLINED_REPLY }
  const last = await lastCompletedBooking(scoped, customer.id)
  if (!last) return { text: "Quiero reservar un turno." }
  const [service, resource] = await Promise.all([
    scoped.services.findById(last.serviceId),
    scoped.resources.findById(last.resourceId),
  ])
  const what = service ? ` de ${service.name.toLowerCase()}` : ""
  const who = resource?.active ? ` con ${resource.name}` : ""
  return { text: `Quiero reservar un turno${what}${who}.` }
}
