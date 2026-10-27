import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { addDaysToDate, dayRange, type DateString } from "@/lib/time"

import { computeAvailability, firstFreePerStart, type Slot } from "./availability"
import { occupyingBookingsWhere } from "./create"

/*
 * Carga de la base lo que necesita computeAvailability() y la llama.
 */

export type FindSlotsInput = {
  serviceId: string
  /** Un profesional en particular; si falta, cualquiera que haga el servicio. */
  resourceId?: string
  /** Solo entre estos profesionales (un profesional del equipo ve solo su agenda). */
  allowedResourceIds?: string[]
  from: DateString
  to?: DateString
  now?: Date
  ignoreBookingWindow?: boolean
  /** Al reprogramar, el turno que se mueve no ocupa su propio lugar. */
  excludeBookingId?: string
}

export async function findSlots(scoped: ScopedDb, input: FindSlotsInput): Promise<Slot[]> {
  const [business, rules, service] = await Promise.all([
    scoped.business(),
    scoped.bookingRules.findFirst(),
    scoped.services.findById(input.serviceId),
  ])
  if (!business || !service || !service.active) return []

  const links = await scoped.resourceServices.findMany({
    where: eq(schema.resourceServices.serviceId, service.id),
  })
  let resourceIds = links.map((l) => l.resourceId)
  if (input.resourceId) resourceIds = resourceIds.filter((id) => id === input.resourceId)
  if (input.allowedResourceIds) {
    const allowed = new Set(input.allowedResourceIds)
    resourceIds = resourceIds.filter((id) => allowed.has(id))
  }
  if (resourceIds.length === 0) return []

  const resources = await scoped.resources.findMany({
    where: and(inArray(schema.resources.id, resourceIds), eq(schema.resources.active, true)),
    orderBy: [schema.resources.name],
  })
  if (resources.length === 0) return []
  const ids = resources.map((r) => r.id)

  const to = input.to ?? input.from
  const start = dayRange(input.from, business.timezone).start
  const end = dayRange(to, business.timezone).end
  // Un día de margen para el buffer de un turno del día anterior.
  const margin = dayRange(addDaysToDate(input.from, -1), business.timezone).start

  const [hours, bookings, blocks] = await Promise.all([
    scoped.workingHours.findMany({ where: inArray(schema.workingHours.resourceId, ids) }),
    scoped.bookings.findMany({
      where: and(occupyingBookingsWhere(margin, end, input.excludeBookingId), inArray(schema.bookings.resourceId, ids)),
    }),
    scoped.timeOff.findMany({
      where: and(
        or(isNull(schema.timeOff.resourceId), inArray(schema.timeOff.resourceId, ids)),
        lt(schema.timeOff.startsAt, end),
        gt(schema.timeOff.endsAt, start),
      ),
    }),
  ])

  const slots = computeAvailability({
    timezone: business.timezone,
    from: input.from,
    to,
    now: input.now ?? new Date(),
    durationMinutes: service.durationMinutes,
    resources: resources.map((r) => ({
      id: r.id,
      workingHours: hours.filter((h) => h.resourceId === r.id),
      durationMinutes: links.find((l) => l.resourceId === r.id)?.customDuration ?? null,
    })),
    busy: [
      ...bookings.map((b) => ({
        resourceId: b.resourceId,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        kind: "booking" as const,
      })),
      ...blocks.map((b) => ({
        resourceId: b.resourceId,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        kind: "time_off" as const,
      })),
    ],
    rules: rules ?? { slotStepMinutes: 15, bufferMinutes: 0, minNoticeMinutes: 0, maxDaysAhead: 60 },
    ignoreBookingWindow: input.ignoreBookingWindow,
  })

  return input.resourceId ? slots : firstFreePerStart(slots, ids)
}

export type { Slot }
