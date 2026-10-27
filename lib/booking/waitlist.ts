import { and, asc, eq, inArray, lt, ne } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatZoned, timeToMinutes, toDateString, toTimeString } from "@/lib/time"

import { BookingError, createBooking } from "./create"
import { findSlots } from "./slots"

/*
 * Lista de espera (docs/SPEC.md, "Lista de espera"): cuando se libera un
 * horario, se avisa por plantilla a los anotados para ese día en orden de
 * llegada; el primero que toca "Lo quiero" se queda con el turno y el resto
 * recibe "ya fue tomado" (y sigue esperando).
 *
 * `offerFreedSlot` corre dentro de la transacción del cambio que libera el
 * lugar y solo deja filas: las ofertas salen como mensajes programados.
 */

/** A cuántas personas se les ofrece un mismo lugar. */
export const MAX_OFFERS_PER_SLOT = 5

export function waitlistButtonId(entryId: string) {
  return `waitlist:accept:${entryId}`
}

export function parseWaitlistButton(id: string | null | undefined): { entryId: string } | null {
  const match = /^waitlist:accept:([0-9a-f-]{36})$/i.exec(id ?? "")
  return match ? { entryId: match[1]!.toLowerCase() } : null
}

export type FreedSlot = { bookingId: string; resourceId: string; startsAt: Date; endsAt: Date }

/** Ofrece un horario liberado a la lista de espera de ese día. Devuelve a cuántos se les ofreció. */
export async function offerFreedSlot(scoped: ScopedDb, freed: FreedSlot, now: Date): Promise<number> {
  if (freed.startsAt <= now) return 0
  const business = await scoped.business()
  if (!business) return 0
  const tz = business.timezone
  const date = toDateString(freed.startsAt, tz)

  const entries = await scoped.waitlistEntries.findMany({
    where: and(eq(schema.waitlistEntries.date, date), eq(schema.waitlistEntries.status, "waiting")),
    orderBy: asc(schema.waitlistEntries.createdAt),
    limit: 30,
  })
  let offered = 0
  for (const entry of entries) {
    if (offered >= MAX_OFFERS_PER_SLOT) break
    if (entry.resourceId && entry.resourceId !== freed.resourceId) continue
    const customer = await scoped.customers.findById(entry.customerId)
    if (!customer || customer.isTest) continue

    const slots = await findSlots(scoped, {
      serviceId: entry.serviceId,
      resourceId: freed.resourceId,
      from: date,
      now,
    })
    const slot = slots.find((s) => {
      if (s.startsAt < freed.startsAt || s.startsAt >= freed.endsAt) return false
      const minute = timeToMinutes(toTimeString(s.startsAt, tz))
      if (entry.fromTime && minute < timeToMinutes(entry.fromTime)) return false
      if (entry.toTime && minute > timeToMinutes(entry.toTime)) return false
      return true
    })
    if (!slot) continue

    await scoped.waitlistEntries.update(eq(schema.waitlistEntries.id, entry.id), {
      status: "offered",
      offeredStartsAt: slot.startsAt,
      offeredResourceId: slot.resourceId,
      offerSourceBookingId: freed.bookingId,
    })
    await scoped.scheduledMessages.insert({
      customerId: entry.customerId,
      waitlistEntryId: entry.id,
      kind: "waitlist_offer",
      sendAt: now,
    })
    offered++
  }
  return offered
}

const TAKEN_REPLY =
  "Uy, ese lugar ya lo tomó otra persona. Seguís en la lista de espera y te avisamos si se libera otro."

/** Vuelve a la espera a los que tenían la misma oferta y les avisa que ya fue tomada. */
async function releaseOtherOffers(scoped: ScopedDb, entry: schema.WaitlistEntry, now: Date) {
  if (!entry.offerSourceBookingId) return
  const others = await scoped.waitlistEntries.findMany({
    where: and(
      eq(schema.waitlistEntries.offerSourceBookingId, entry.offerSourceBookingId),
      eq(schema.waitlistEntries.status, "offered"),
      ne(schema.waitlistEntries.id, entry.id),
    ),
  })
  for (const other of others) {
    await scoped.waitlistEntries.update(eq(schema.waitlistEntries.id, other.id), { status: "waiting" })
    // Cancela la oferta si todavía no salió; si salió, avisa que ya fue tomada.
    const [unsent] = await scoped.scheduledMessages.update(
      and(
        eq(schema.scheduledMessages.waitlistEntryId, other.id),
        eq(schema.scheduledMessages.kind, "waitlist_offer"),
        eq(schema.scheduledMessages.status, "pending"),
      ),
      { status: "cancelled", lastError: "El lugar ya fue tomado." },
    )
    if (!unsent) {
      await scoped.scheduledMessages.insert({
        customerId: other.customerId,
        waitlistEntryId: other.id,
        kind: "waitlist_taken",
        sendAt: now,
      })
    }
  }
}

/**
 * El cliente tocó "Lo quiero": si el lugar sigue libre se le reserva (con
 * seña si corresponde) y el resto recibe "ya fue tomado". Responde sin IA.
 */
export async function acceptWaitlistOffer(
  scoped: ScopedDb,
  customer: schema.Customer,
  entryId: string,
  title: string,
  now: Date,
): Promise<{ text: string; autoReply: string }> {
  const entry = await scoped.waitlistEntries.findFirst(
    and(eq(schema.waitlistEntries.id, entryId), eq(schema.waitlistEntries.customerId, customer.id)),
  )
  if (!entry || entry.status === "booked") {
    return {
      text: title,
      autoReply: entry ? "Ese turno ya quedó reservado a tu nombre." : TAKEN_REPLY,
    }
  }
  if (entry.status !== "offered" || !entry.offeredStartsAt || !entry.offeredResourceId || entry.offeredStartsAt <= now) {
    return { text: title, autoReply: TAKEN_REPLY }
  }

  try {
    const booking = await createBooking(
      scoped,
      {
        customerId: customer.id,
        resourceId: entry.offeredResourceId,
        serviceId: entry.serviceId,
        startsAt: entry.offeredStartsAt,
        source: "whatsapp",
        requestDeposit: true,
      },
      { type: "customer", id: customer.id, channel: "whatsapp" },
      { now },
    )
    await scoped.transaction(async (tx) => {
      await tx.waitlistEntries.update(eq(schema.waitlistEntries.id, entry.id), {
        status: "booked",
        bookedBookingId: booking.id,
      })
      await releaseOtherOffers(tx, entry, now)
    })
    const [business, service, resource] = await Promise.all([
      scoped.business(),
      scoped.services.findById(booking.serviceId),
      scoped.resources.findById(booking.resourceId),
    ])
    const tz = business?.timezone ?? "UTC"
    const when = `el ${formatZoned(booking.startsAt, tz, "EEEE d 'de' MMMM")} a las ${toTimeString(booking.startsAt, tz)}`
    const what = `${service?.name ?? "tu turno"}${resource ? ` con ${resource.name}` : ""}`
    return {
      text: title,
      autoReply:
        booking.status === "pending_payment"
          ? `¡Es tuyo! Te guardamos ${what} ${when}. Para confirmarlo falta la seña: ahora te mandamos el link de pago.`
          : `¡Listo! Te reservamos ${what} ${when}. Te esperamos.`,
    }
  } catch (error) {
    if (!(error instanceof BookingError)) throw error
    await scoped.waitlistEntries.update(eq(schema.waitlistEntries.id, entry.id), { status: "waiting" })
    return { text: title, autoReply: TAKEN_REPLY }
  }
}

/** Las esperas de días que ya pasaron se cierran (cron horario). */
export async function expireOldWaitlist(scoped: ScopedDb, timezone: string, now: Date) {
  const rows = await scoped.waitlistEntries.update(
    and(
      inArray(schema.waitlistEntries.status, ["waiting", "offered"]),
      lt(schema.waitlistEntries.date, toDateString(now, timezone)),
    ),
    { status: "expired" },
  )
  return rows.length
}
