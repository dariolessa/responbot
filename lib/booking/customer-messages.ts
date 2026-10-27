import { and, eq, inArray } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { notify } from "@/lib/notifications/dispatch"
import type { BookingPayload } from "@/lib/notifications/types"
import { formatZoned, toDateString, toTimeString } from "@/lib/time"

import type { Actor } from "./create"
import { queueReviewRequest } from "./follow-ups"
import { isOpen, occupyingStatuses } from "./policies"
import { offerFreedSlot } from "./waitlist"

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
  | {
      kind: "moved"
      previousStartsAt: Date
      /** Lugar que dejó libre (para la lista de espera). */
      previous?: { resourceId: string; startsAt: Date; endsAt: Date }
    }
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

const immediateKinds = ["booking_confirmation", "booking_cancelled", "deposit_request", "hold_expired"] as const

async function queueNow(scoped: ScopedDb, booking: schema.Booking, kind: (typeof immediateKinds)[number], now: Date) {
  await cancelPending(scoped, booking.id, [...immediateKinds])
  await scoped.scheduledMessages.insert({ bookingId: booking.id, customerId: booking.customerId, kind, sendAt: now })
}

export async function onBookingChange(
  scoped: ScopedDb,
  booking: schema.Booking,
  change: BookingChange,
  actor: Actor,
  now: Date = new Date(),
) {
  // Lugar liberado (también por un turno del chat de prueba): se ofrece a la lista de espera de ese día.
  const occupying = (status: schema.Booking["status"]) => (occupyingStatuses as readonly string[]).includes(status)
  if (change.kind === "status" && occupying(change.from) && !occupying(booking.status)) {
    await offerFreedSlot(
      scoped,
      { bookingId: booking.id, resourceId: booking.resourceId, startsAt: booking.startsAt, endsAt: booking.endsAt },
      now,
    )
  } else if (change.kind === "moved" && change.previous) {
    await offerFreedSlot(scoped, { bookingId: booking.id, ...change.previous }, now)
  }

  const customer = await scoped.customers.findById(booking.customerId)
  if (!customer || customer.isTest || booking.source === "test_chat") return
  const business = await scoped.business()
  if (!business) return

  await syncReminders(scoped, booking, now)

  // Pedido de reseña al marcarlo atendido.
  if (change.kind === "status" && booking.status === "completed") await queueReviewRequest(scoped, booking, now)

  // Al cliente: si el cambio lo hizo el equipo desde el panel. Si fue por WhatsApp, el bot ya se lo dijo.
  // La seña (link de pago, pago recibido y retención vencida) se avisa siempre.
  const byTeam = actor.type === "user"
  const upcoming = booking.startsAt > now
  const held = booking.status === "pending_payment"
  const paid = change.kind === "status" && change.from === "pending_payment" && booking.status === "confirmed"
  if (upcoming) {
    if (change.kind === "created" && held) await queueNow(scoped, booking, "deposit_request", now)
    else if (paid) await queueNow(scoped, booking, "booking_confirmation", now)
    else if (booking.status === "expired" && change.kind === "status") await queueNow(scoped, booking, "hold_expired", now)
    else if (byTeam && (change.kind === "created" || change.kind === "moved") && !held) {
      await queueNow(scoped, booking, "booking_confirmation", now)
    } else if (byTeam && booking.status === "cancelled") await queueNow(scoped, booking, "booking_cancelled", now)
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
      payload: {
        ...(await bookingPayload(scoped, booking, business.timezone)),
        byBot: actor.type === "bot",
        awaitingDeposit: held,
      },
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
