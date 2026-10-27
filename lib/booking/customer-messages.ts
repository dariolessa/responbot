import { and, eq, inArray } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { notify } from "@/lib/notifications/dispatch"
import type { BookingPayload } from "@/lib/notifications/types"
import { formatZoned, toDateString, toTimeString } from "@/lib/time"

import type { Actor } from "./create"
import { isOpen } from "./policies"

/*
 * Lo que dispara un cambio de turno (docs/SPEC.md, "Estados del turno": cada
 * cambio "dispara las notificaciones que correspondan"):
 *
 * - Mensajes al cliente por WhatsApp, en `scheduled_messages`: recordatorios
 *   (24 h con botones y 2 h corto, configurables en las reglas), y la
 *   confirmación o el aviso de cancelación cuando el turno lo toca el equipo
 *   desde el panel. Los manda lib/whatsapp/scheduled.ts.
 * - Avisos al equipo con el despachador (reserva nueva, cancelada o movida).
 *
 * Corre dentro de la transacción del cambio. El chat de prueba no dispara nada.
 */

export const reminderKinds = ["reminder_24h", "reminder_2h"] as const
type ReminderKind = (typeof reminderKinds)[number]

export type BookingChange =
  | { kind: "created" }
  | { kind: "moved"; previousStartsAt: Date }
  | { kind: "status"; from: schema.Booking["status"] }

/** Datos del turno para los avisos, ya en la zona del negocio. */
export async function bookingPayload(
  scoped: ScopedDb,
  booking: schema.Booking,
  timezone: string,
): Promise<BookingPayload> {
  const [customer, service, resource] = await Promise.all([
    scoped.customers.findById(booking.customerId),
    scoped.services.findById(booking.serviceId),
    scoped.resources.findById(booking.resourceId),
  ])
  return {
    bookingId: booking.id,
    customerName: customer?.name ?? "Cliente sin nombre",
    serviceName: service?.name ?? "Turno",
    staffName: resource?.name ?? "",
    date: toDateString(booking.startsAt, timezone),
    day: formatZoned(booking.startsAt, timezone, "EEEE d 'de' MMMM"),
    time: toTimeString(booking.startsAt, timezone),
  }
}

/** Cuándo sale cada recordatorio según las reglas (null = apagado). */
export function reminderTimes(
  startsAt: Date,
  rules: Pick<schema.BookingRules, "reminderFirstHours" | "reminderSecondHours"> | undefined,
): Record<ReminderKind, Date | null> {
  const first = rules ? rules.reminderFirstHours : 24
  const second = rules ? rules.reminderSecondHours : 2
  const at = (hours: number | null) => (hours ? new Date(startsAt.getTime() - hours * 3_600_000) : null)
  return { reminder_24h: at(first), reminder_2h: at(second) }
}

async function cancelPending(scoped: ScopedDb, bookingId: string, kinds: schema.ScheduledMessage["kind"][]) {
  await scoped.scheduledMessages.update(
    and(
      eq(schema.scheduledMessages.bookingId, bookingId),
      eq(schema.scheduledMessages.status, "pending"),
      inArray(schema.scheduledMessages.kind, kinds),
    ),
    { status: "cancelled", lastError: "El turno cambió" },
  )
}

/** Deja los recordatorios pendientes de un turno en línea con su horario y su estado. */
export async function syncReminders(scoped: ScopedDb, booking: schema.Booking, now: Date) {
  if (!isOpen(booking.status) || booking.startsAt <= now) {
    await cancelPending(scoped, booking.id, [...reminderKinds])
    return
  }
  const rules = await scoped.bookingRules.findFirst()
  const times = reminderTimes(booking.startsAt, rules)
  for (const kind of reminderKinds) {
    const sendAt = times[kind]
    const existing = await scoped.scheduledMessages.findFirst(
      and(
        eq(schema.scheduledMessages.bookingId, booking.id),
        eq(schema.scheduledMessages.kind, kind),
        eq(schema.scheduledMessages.status, "pending"),
      ),
    )
    // Si el momento ya pasó (turno reservado con poca anticipación), ese recordatorio no va.
    if (!sendAt || sendAt <= now) {
      if (existing) await cancelPending(scoped, booking.id, [kind])
      continue
    }
    if (existing) {
      if (existing.sendAt.getTime() !== sendAt.getTime()) {
        await scoped.scheduledMessages.update(eq(schema.scheduledMessages.id, existing.id), { sendAt, attempts: 0 })
      }
    } else {
      await scoped.scheduledMessages.insert({ bookingId: booking.id, customerId: booking.customerId, kind, sendAt })
    }
  }
}

async function queueNow(scoped: ScopedDb, booking: schema.Booking, kind: "booking_confirmation" | "booking_cancelled", now: Date) {
  await cancelPending(scoped, booking.id, ["booking_confirmation", "booking_cancelled"])
  await scoped.scheduledMessages.insert({ bookingId: booking.id, customerId: booking.customerId, kind, sendAt: now })
}

export async function onBookingChange(
  scoped: ScopedDb,
  booking: schema.Booking,
  change: BookingChange,
  actor: Actor,
  now: Date = new Date(),
) {
  const customer = await scoped.customers.findById(booking.customerId)
  if (!customer || customer.isTest || booking.source === "test_chat") return
  const business = await scoped.business()
  if (!business) return

  await syncReminders(scoped, booking, now)

  // Al cliente: si el cambio lo hizo el equipo desde el panel. Si fue por WhatsApp, el bot ya se lo dijo.
  const byTeam = actor.type === "user"
  if (byTeam && booking.startsAt > now) {
    if (change.kind === "created" || change.kind === "moved") await queueNow(scoped, booking, "booking_confirmation", now)
    else if (booking.status === "cancelled") await queueNow(scoped, booking, "booking_cancelled", now)
  }

  // Al equipo.
  const base = {
    resourceId: booking.resourceId,
    excludeUserId: byTeam ? actor.id : null,
    now,
  }
  const byCustomer = actor.type === "bot" || actor.type === "customer"
  if (change.kind === "created") {
    await notify(scoped, {
      ...base,
      type: "booking.created",
      payload: { ...(await bookingPayload(scoped, booking, business.timezone)), byBot: actor.type === "bot" },
    })
  } else if (change.kind === "moved") {
    await notify(scoped, {
      ...base,
      type: "booking.changed",
      payload: { ...(await bookingPayload(scoped, booking, business.timezone)), change: "rescheduled", byCustomer },
    })
  } else if (booking.status === "cancelled" && change.from !== "cancelled") {
    await notify(scoped, {
      ...base,
      type: "booking.changed",
      payload: { ...(await bookingPayload(scoped, booking, business.timezone)), change: "cancelled", byCustomer },
    })
  }
}
