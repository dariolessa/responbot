import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

import {
  canTransition,
  isOpen,
  occupyingStatuses,
  statusLabels,
  type BookingStatus,
} from "./policies"

/*
 * Crear, mover y cambiar de estado un turno. Lo usan el panel y (desde la
 * Fase 2) el bot. La base rechaza superposiciones con la exclusión gist de
 * bookings aunque lleguen dos pedidos al mismo tiempo; acá se traduce ese
 * rechazo a un mensaje claro.
 */

export type Actor = {
  type: (typeof schema.actorTypeEnum.enumValues)[number]
  id: string | null
  channel: (typeof schema.channelEnum.enumValues)[number]
}

/** Error con un mensaje listo para mostrar. */
export class BookingError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "time_off" | "not_found" | "invalid",
  ) {
    super(message)
    this.name = "BookingError"
  }
}

const MINUTE = 60_000

/** Código de Postgres para una violación de la exclusión (bookings_no_overlap). */
function isExclusionViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; cause?: unknown }
    if (e.code === "23P01" || e.message?.includes("bookings_no_overlap")) return true
    current = e.cause
  }
  return false
}

async function assertNoTimeOff(tx: ScopedDb, resourceId: string, startsAt: Date, endsAt: Date) {
  const block = await tx.timeOff.findFirst(
    and(
      or(isNull(schema.timeOff.resourceId), eq(schema.timeOff.resourceId, resourceId)),
      lt(schema.timeOff.startsAt, endsAt),
      gt(schema.timeOff.endsAt, startsAt),
    ),
  )
  if (block) {
    throw new BookingError(
      block.reason
        ? `Ese horario está bloqueado (${block.reason}).`
        : "Ese horario está bloqueado en la agenda.",
      "time_off",
    )
  }
}

/** Duración y precio de un servicio para un profesional (con sus valores propios si los tiene). */
async function serviceTerms(tx: ScopedDb, resourceId: string, serviceId: string) {
  const [resource, service, link] = await Promise.all([
    tx.resources.findById(resourceId),
    tx.services.findById(serviceId),
    tx.resourceServices.findFirst(
      and(
        eq(schema.resourceServices.resourceId, resourceId),
        eq(schema.resourceServices.serviceId, serviceId),
      ),
    ),
  ])
  if (!resource || !resource.active) throw new BookingError("Ese profesional no está disponible.", "not_found")
  if (!service) throw new BookingError("Ese servicio no existe.", "not_found")
  if (!link) throw new BookingError(`${resource.name} no hace ${service.name}.`, "invalid")
  return {
    resource,
    service,
    durationMinutes: link.customDuration ?? service.durationMinutes,
    price: link.customPrice ?? service.price,
  }
}

export type CreateBookingInput = {
  customerId: string
  resourceId: string
  serviceId: string
  startsAt: Date
  source: (typeof schema.bookingSourceEnum.enumValues)[number]
}

export async function createBooking(
  scoped: ScopedDb,
  input: CreateBookingInput,
  actor: Actor,
): Promise<schema.Booking> {
  try {
    return await scoped.transaction(async (tx) => {
      const business = await tx.business()
      if (!business) throw new BookingError("No encontramos el negocio.", "not_found")
      const customer = await tx.customers.findById(input.customerId)
      if (!customer) throw new BookingError("No encontramos al cliente.", "not_found")
      if (!input.startsAt || Number.isNaN(input.startsAt.getTime())) {
        throw new BookingError("Elegí un día y un horario.", "invalid")
      }

      const terms = await serviceTerms(tx, input.resourceId, input.serviceId)
      if (!terms.service.active) throw new BookingError("Ese servicio está pausado.", "invalid")
      const endsAt = new Date(input.startsAt.getTime() + terms.durationMinutes * MINUTE)
      await assertNoTimeOff(tx, input.resourceId, input.startsAt, endsAt)

      const [booking] = await tx.bookings.insert({
        customerId: customer.id,
        resourceId: input.resourceId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt,
        status: "confirmed",
        price: terms.price,
        currency: business.currency,
        // Las señas con Mercado Pago llegan en la Fase 5; un turno del panel se confirma directo.
        depositAmount: 0,
        depositStatus: "none",
        source: input.source,
      })
      await tx.bookingEvents.insert({
        bookingId: booking!.id,
        fromStatus: null,
        toStatus: "confirmed",
        actorType: actor.type,
        actorId: actor.id,
        channel: actor.channel,
      })
      return booking!
    })
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new BookingError("Ese horario ya está ocupado. Elegí otro.", "conflict")
    }
    throw error
  }
}

export type MoveBookingInput = {
  bookingId: string
  startsAt: Date
  /** Otro profesional; si no se pasa, sigue con el mismo. */
  resourceId?: string
}

/** Reprograma un turno abierto, manteniendo su duración. */
export async function moveBooking(
  scoped: ScopedDb,
  input: MoveBookingInput,
  actor: Actor,
): Promise<schema.Booking> {
  try {
    return await scoped.transaction(async (tx) => {
      const booking = await tx.bookings.findById(input.bookingId)
      if (!booking) throw new BookingError("No encontramos el turno.", "not_found")
      if (!isOpen(booking.status)) {
        throw new BookingError(
          `Un turno ${statusLabels[booking.status].toLowerCase()} no se puede mover.`,
          "invalid",
        )
      }
      const resourceId = input.resourceId ?? booking.resourceId
      let durationMs = booking.endsAt.getTime() - booking.startsAt.getTime()
      let price = booking.price
      if (resourceId !== booking.resourceId) {
        // Con otro profesional rigen su duración y su precio para ese servicio.
        const terms = await serviceTerms(tx, resourceId, booking.serviceId)
        durationMs = terms.durationMinutes * MINUTE
        price = terms.price
      }
      const endsAt = new Date(input.startsAt.getTime() + durationMs)
      await assertNoTimeOff(tx, resourceId, input.startsAt, endsAt)

      const [updated] = await tx.bookings.update(eq(schema.bookings.id, booking.id), {
        resourceId,
        startsAt: input.startsAt,
        endsAt,
        price,
      })
      // Un movimiento queda en el historial como un evento sin cambio de estado.
      await tx.bookingEvents.insert({
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorType: actor.type,
        actorId: actor.id,
        channel: actor.channel,
      })
      return updated!
    })
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new BookingError("Ese horario ya está ocupado. Elegí otro.", "conflict")
    }
    throw error
  }
}

export async function changeBookingStatus(
  scoped: ScopedDb,
  input: { bookingId: string; to: BookingStatus; cancelReason?: string | null },
  actor: Actor,
): Promise<schema.Booking> {
  return scoped.transaction(async (tx) => {
    const booking = await tx.bookings.findById(input.bookingId)
    if (!booking) throw new BookingError("No encontramos el turno.", "not_found")
    if (!canTransition(booking.status, input.to)) {
      throw new BookingError(
        `No se puede pasar de "${statusLabels[booking.status]}" a "${statusLabels[input.to]}".`,
        "invalid",
      )
    }
    const [updated] = await tx.bookings.update(
      and(eq(schema.bookings.id, booking.id), eq(schema.bookings.status, booking.status)),
      {
        status: input.to,
        cancelReason: input.to === "cancelled" ? input.cancelReason?.trim() || null : booking.cancelReason,
      },
    )
    if (!updated) throw new BookingError("El turno cambió mientras tanto. Probá de nuevo.", "conflict")
    await tx.bookingEvents.insert({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: input.to,
      actorType: actor.type,
      actorId: actor.id,
      channel: actor.channel,
    })
    if (input.to === "completed" || input.to === "no_show") {
      await refreshCustomerStats(tx, booking.customerId)
    }
    return updated
  })
}

/**
 * Recalcula visitas, intervalo promedio e inasistencias del cliente a partir
 * de sus turnos (customers.last_visit_at, avg_interval_days, no_show_count).
 */
export async function refreshCustomerStats(scoped: ScopedDb, customerId: string) {
  const rows = await scoped.bookings.findMany({
    where: and(
      eq(schema.bookings.customerId, customerId),
      inArray(schema.bookings.status, ["completed", "no_show"]),
    ),
    orderBy: asc(schema.bookings.startsAt),
  })
  const visits = rows.filter((r) => r.status === "completed")
  const noShows = rows.length - visits.length
  const last = visits.at(-1)?.startsAt ?? null
  const first = visits[0]?.startsAt
  const avgIntervalDays =
    visits.length >= 2 && first && last
      ? Math.round((last.getTime() - first.getTime()) / (visits.length - 1) / 86_400_000)
      : null

  await scoped.customers.update(eq(schema.customers.id, customerId), {
    lastVisitAt: last,
    avgIntervalDays,
    noShowCount: noShows,
  })
}

/** Turnos que ocupan lugar en un rango, para el cálculo de disponibilidad. */
export function occupyingBookingsWhere(start: Date, end: Date, excludeBookingId?: string) {
  return and(
    lt(schema.bookings.startsAt, end),
    gt(schema.bookings.endsAt, start),
    inArray(schema.bookings.status, [...occupyingStatuses]),
    excludeBookingId ? ne(schema.bookings.id, excludeBookingId) : undefined,
  )
}
