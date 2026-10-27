import { and, asc, eq, gte, inArray } from "drizzle-orm"
import { z } from "zod"

import {
  BookingError,
  changeBookingStatus,
  createBooking,
  moveBooking,
} from "@/lib/booking/create"
import { billingState, hasFeature } from "@/lib/billing/state"
import { openStatuses } from "@/lib/booking/policies"
import { findSlots, type Slot } from "@/lib/booking/slots"
import * as schema from "@/lib/db/schema"
import { formatMoney } from "@/lib/money"
import { requestDepositRefund } from "@/lib/payments/mercadopago"
import {
  addDaysToDate,
  formatZoned,
  timeToMinutes,
  toDateString,
  toTimeString,
  zonedToUtc,
  type DateString,
} from "@/lib/time"

import {
  bookingSource,
  botActor,
  dateField,
  defineTool,
  idField,
  timeField,
  ToolError,
  type ToolContext,
} from "./define"

/** Rango máximo que revisa una consulta de disponibilidad. */
const MAX_RANGE_DAYS = 7
/** Cuántos días más adelante busca el próximo hueco si el rango pedido está lleno. */
const LOOKAHEAD_DAYS = 21
const SLOTS_PER_DAY = 6
const MAX_SLOTS = 18

function today(ctx: ToolContext): DateString {
  return toDateString(ctx.now, ctx.business.timezone)
}

function dayLabel(instant: Date, ctx: ToolContext) {
  return formatZoned(instant, ctx.business.timezone, "EEEE d 'de' MMMM")
}

async function staffNames(ctx: ToolContext, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const rows = await ctx.scoped.resources.findMany({ where: inArray(schema.resources.id, ids) })
  return new Map(rows.map((r) => [r.id, r.name]))
}

async function requireService(ctx: ToolContext, serviceId: string) {
  const service = await ctx.scoped.services.findById(serviceId)
  if (!service || !service.active) {
    throw new ToolError("Ese servicio no existe o está pausado. Revisá list_services.")
  }
  return service
}

function assertCanBook(ctx: ToolContext) {
  if (!ctx.canBook) {
    throw new ToolError(
      "Por ahora el negocio no está tomando reservas por este medio. Decile al cliente que un integrante del equipo lo va a contactar y usá handoff_to_human.",
    )
  }
}

/** Turno del cliente de esta conversación que todavía se puede tocar. */
async function requireOwnOpenBooking(ctx: ToolContext, bookingId: string) {
  const booking = await ctx.scoped.bookings.findFirst(
    and(eq(schema.bookings.id, bookingId), eq(schema.bookings.customerId, ctx.customer.id)),
  )
  if (!booking) throw new ToolError("No encontré ese turno entre los del cliente. Usá get_customer_bookings.")
  if (!(openStatuses as readonly string[]).includes(booking.status) || booking.startsAt <= ctx.now) {
    throw new ToolError("Ese turno ya pasó, se canceló o se venció; no se puede modificar.")
  }
  return booking
}

function hoursUntil(ctx: ToolContext, instant: Date) {
  return (instant.getTime() - ctx.now.getTime()) / 3_600_000
}

/** Busca el horario pedido entre los libres; así el bot respeta las mismas reglas que se ofrecen. */
async function findRequestedSlot(
  ctx: ToolContext,
  input: {
    serviceId: string
    staffId?: string
    date: DateString
    time: string
    excludeBookingId?: string
  },
): Promise<Slot | undefined> {
  const slots = await findSlots(ctx.scoped, {
    serviceId: input.serviceId,
    resourceId: input.staffId,
    from: input.date,
    now: ctx.now,
    excludeBookingId: input.excludeBookingId,
  })
  const startsAt = zonedToUtc(input.date, input.time, ctx.business.timezone).getTime()
  return slots.find((s) => s.startsAt.getTime() === startsAt)
}

function translateBookingError(error: unknown): never {
  if (error instanceof BookingError) throw new ToolError(error.message)
  throw error
}

function bookingSummary(
  ctx: ToolContext,
  booking: schema.Booking,
  names: { service?: string; staff?: string },
) {
  return {
    booking_id: booking.id,
    service: names.service,
    staff: names.staff,
    date: toDateString(booking.startsAt, ctx.business.timezone),
    day: dayLabel(booking.startsAt, ctx),
    time: toTimeString(booking.startsAt, ctx.business.timezone),
    ends_at: toTimeString(booking.endsAt, ctx.business.timezone),
    price: formatMoney(booking.price, booking.currency),
    status: booking.status,
    ...(booking.depositAmount > 0
      ? {
          deposit: formatMoney(booking.depositAmount, booking.currency),
          deposit_status: booking.depositStatus,
          ...(booking.status === "pending_payment" && booking.holdExpiresAt
            ? { hold_until: toTimeString(booking.holdExpiresAt, ctx.business.timezone) }
            : {}),
        }
      : {}),
  }
}

export const checkAvailability = defineTool({
  name: "check_availability",
  description: `Horarios libres para un servicio, con un profesional opcional, entre dos fechas (hasta ${MAX_RANGE_DAYS} días). Se puede filtrar por franja horaria. Si no hay lugar en el rango, devuelve el próximo día con lugar. Nunca ofrezcas un horario que no salga de acá.`,
  input: z.object({
    service_id: idField("el servicio"),
    staff_id: idField("el profesional").optional().describe("Solo si el cliente pidió alguien en particular."),
    date_from: dateField.describe("Primer día, AAAA-MM-DD, en la zona del negocio."),
    date_to: dateField.optional().describe("Último día (incluido). Si falta, solo date_from."),
    from_time: timeField.optional().describe("Desde esta hora (por ejemplo 14:00 para 'a la tarde')."),
    to_time: timeField.optional().describe("Hasta esta hora de inicio."),
  }),
  async run(input, ctx) {
    const service = await requireService(ctx, input.service_id)
    const first = input.date_from < today(ctx) ? today(ctx) : input.date_from
    let last = input.date_to && input.date_to >= first ? input.date_to : first
    if (last > addDaysToDate(first, MAX_RANGE_DAYS - 1)) last = addDaysToDate(first, MAX_RANGE_DAYS - 1)

    const tz = ctx.business.timezone
    const inWindow = (slot: Slot) => {
      const minute = timeToMinutes(toTimeString(slot.startsAt, tz))
      if (input.from_time && minute < timeToMinutes(input.from_time)) return false
      if (input.to_time && minute > timeToMinutes(input.to_time)) return false
      return true
    }
    const search = (from: DateString, to: DateString) =>
      findSlots(ctx.scoped, { serviceId: service.id, resourceId: input.staff_id, from, to, now: ctx.now }).then(
        (slots) => slots.filter(inWindow),
      )

    const slots = await search(first, last)
    if (slots.length === 0) {
      const later = await search(addDaysToDate(last, 1), addDaysToDate(last, LOOKAHEAD_DAYS))
      const next = later[0]
      return {
        service: service.name,
        available: false,
        next_available_date: next ? toDateString(next.startsAt, tz) : null,
        next_available_day: next ? dayLabel(next.startsAt, ctx) : null,
        hint: next
          ? "No hay lugar en esas fechas. Ofrecé el próximo día con lugar (consultá sus horarios) o la lista de espera."
          : "No hay lugar en las próximas semanas. Ofrecé la lista de espera.",
      }
    }

    // Los más cercanos primero, sin llenar la respuesta con un solo día.
    const perDay = new Map<string, number>()
    const picked = slots.filter((slot) => {
      const day = toDateString(slot.startsAt, tz)
      const count = perDay.get(day) ?? 0
      if (count >= SLOTS_PER_DAY) return false
      perDay.set(day, count + 1)
      return true
    })
    const shown = picked.slice(0, MAX_SLOTS)
    const names = await staffNames(ctx, [...new Set(shown.map((s) => s.resourceId))])

    return {
      service: service.name,
      available: true,
      slots: shown.map((s) => ({
        date: toDateString(s.startsAt, tz),
        day: dayLabel(s.startsAt, ctx),
        time: toTimeString(s.startsAt, tz),
        staff_id: s.resourceId,
        staff_name: names.get(s.resourceId),
      })),
      more_available: slots.length > shown.length,
      hint: "Ofrecé de 3 a 5 horarios, los más cercanos primero.",
    }
  },
})

export const createBookingTool = defineTool({
  name: "create_booking",
  description:
    "Reserva un turno. Usala solo después de confirmar servicio, profesional, día y hora en un mensaje y de que el cliente dijo que sí. El horario tiene que haber salido de check_availability.",
  input: z.object({
    service_id: idField("el servicio"),
    staff_id: idField("el profesional").optional().describe("Si el cliente no eligió, se asigna el primero libre."),
    date: dateField,
    time: timeField,
  }),
  async run(input, ctx) {
    assertCanBook(ctx)
    const service = await requireService(ctx, input.service_id)
    const slot = await findRequestedSlot(ctx, {
      serviceId: service.id,
      staffId: input.staff_id,
      date: input.date,
      time: input.time,
    })
    if (!slot) {
      throw new ToolError(
        "Ese horario ya no está libre o no cumple las reglas de reserva. Volvé a consultar check_availability y ofrecé otros.",
      )
    }

    const booking = await createBooking(
      ctx.scoped,
      {
        customerId: ctx.customer.id,
        resourceId: slot.resourceId,
        serviceId: service.id,
        startsAt: slot.startsAt,
        source: bookingSource(ctx),
        // El chat de prueba no cobra señas: no hay a quién mandarle el link.
        requestDeposit: ctx.channel === "whatsapp",
      },
      botActor(ctx),
      { now: ctx.now },
    ).catch(translateBookingError)

    const names = await staffNames(ctx, [slot.resourceId])
    const summary = bookingSummary(ctx, booking, { service: service.name, staff: names.get(slot.resourceId) })
    if (booking.status === "pending_payment") {
      return {
        created: true,
        deposit_required: true,
        ...summary,
        hint: `El turno queda guardado hasta las ${summary.hold_until} esperando la seña de ${summary.deposit}; se confirma solo cuando se paga. El link de pago de Mercado Pago le llega en un mensaje aparte enseguida: decíselo, sin escribir ningún link vos.`,
      }
    }
    return { created: true, ...summary }
  },
})

export const getCustomerBookings = defineTool({
  name: "get_customer_bookings",
  description: "Turnos próximos del cliente de esta conversación (para confirmarlos, moverlos o cancelarlos).",
  input: z.object({}),
  async run(_input, ctx) {
    const bookings = await ctx.scoped.bookings.findMany({
      where: and(
        eq(schema.bookings.customerId, ctx.customer.id),
        gte(schema.bookings.startsAt, ctx.now),
        inArray(schema.bookings.status, [...openStatuses]),
      ),
      orderBy: asc(schema.bookings.startsAt),
      limit: 10,
    })
    const [services, staff] = await Promise.all([
      ctx.scoped.services.findMany({
        where: bookings.length ? inArray(schema.services.id, bookings.map((b) => b.serviceId)) : undefined,
      }),
      staffNames(ctx, bookings.map((b) => b.resourceId)),
    ])
    const serviceName = new Map(services.map((s) => [s.id, s.name]))
    return {
      bookings: bookings.map((b) =>
        bookingSummary(ctx, b, { service: serviceName.get(b.serviceId), staff: staff.get(b.resourceId) }),
      ),
    }
  },
})

export const rescheduleBooking = defineTool({
  name: "reschedule_booking",
  description:
    "Mueve un turno del cliente a otro horario libre (de check_availability). Respeta la política de cancelación: con menos anticipación que la permitida no se puede mover por acá.",
  input: z.object({
    booking_id: idField("el turno"),
    date: dateField,
    time: timeField,
    staff_id: idField("el profesional").optional().describe("Solo si cambia de profesional."),
  }),
  async run(input, ctx) {
    assertCanBook(ctx)
    const booking = await requireOwnOpenBooking(ctx, input.booking_id)
    const cancelHours = ctx.rules?.cancelHours ?? 0
    if (hoursUntil(ctx, booking.startsAt) < cancelHours) {
      throw new ToolError(
        `Faltan menos de ${cancelHours} horas para el turno y la política no permite moverlo por este medio. Ofrecé pasarle la conversación a una persona del equipo.`,
      )
    }
    const staffId = input.staff_id ?? booking.resourceId
    const slot = await findRequestedSlot(ctx, {
      serviceId: booking.serviceId,
      staffId,
      date: input.date,
      time: input.time,
      excludeBookingId: booking.id,
    })
    if (!slot) {
      throw new ToolError("Ese horario no está libre. Consultá check_availability y ofrecé otros.")
    }
    const moved = await moveBooking(
      ctx.scoped,
      { bookingId: booking.id, startsAt: slot.startsAt, resourceId: slot.resourceId },
      botActor(ctx),
      { now: ctx.now },
    ).catch(translateBookingError)

    const [service, names] = await Promise.all([
      ctx.scoped.services.findById(moved.serviceId),
      staffNames(ctx, [moved.resourceId]),
    ])
    return {
      moved: true,
      ...bookingSummary(ctx, moved, { service: service?.name, staff: names.get(moved.resourceId) }),
    }
  },
})

export const cancelBookingTool = defineTool({
  name: "cancel_booking",
  description:
    "Cancela un turno del cliente. Antes de usarla confirmá con el cliente cuál turno cancela. Informa si la cancelación queda fuera del plazo de la política.",
  input: z.object({
    booking_id: idField("el turno"),
    reason: z.string().trim().max(200).optional().describe("Motivo, si el cliente lo dijo."),
  }),
  async run(input, ctx) {
    const booking = await requireOwnOpenBooking(ctx, input.booking_id)
    const cancelHours = ctx.rules?.cancelHours ?? 0
    const late = hoursUntil(ctx, booking.startsAt) < cancelHours
    await changeBookingStatus(
      ctx.scoped,
      { bookingId: booking.id, to: "cancelled", cancelReason: input.reason || "Cancelado por el cliente" },
      botActor(ctx),
      { now: ctx.now },
    ).catch(translateBookingError)
    // La lista de espera de ese día recibe la oferta del lugar (lib/booking/waitlist.ts).
    const paid = booking.depositStatus === "paid"
    const refund = paid && !late ? await requestDepositRefund(ctx.scoped, booking.id) : false
    const deposit = formatMoney(booking.depositAmount, booking.currency)
    return {
      cancelled: true,
      booking_id: booking.id,
      late_cancellation: late,
      deposit_refund: refund,
      hint: !paid
        ? late
          ? `Se canceló con menos de ${cancelHours} horas de anticipación.`
          : "Cancelado dentro del plazo de la política."
        : refund
          ? `Cancelado dentro del plazo: la seña de ${deposit} se le devuelve por Mercado Pago (puede tardar unos días según el medio de pago).`
          : `Se canceló con menos de ${cancelHours} horas de anticipación: según la política, la seña de ${deposit} no se devuelve.`,
    }
  },
})

export const joinWaitlist = defineTool({
  name: "join_waitlist",
  description:
    "Anota al cliente en la lista de espera para un servicio en un día (y franja opcional) sin lugar. Si se libera un horario, se le avisa.",
  input: z.object({
    service_id: idField("el servicio"),
    date: dateField,
    staff_id: idField("el profesional").optional(),
    from_time: timeField.optional(),
    to_time: timeField.optional(),
  }),
  async run(input, ctx) {
    if (!hasFeature(billingState(ctx.business, ctx.now), "waitlist")) {
      throw new ToolError("Este negocio no tiene lista de espera. Ofrecé otros días u horarios libres.")
    }
    const service = await requireService(ctx, input.service_id)
    if (input.date < today(ctx)) throw new ToolError("Esa fecha ya pasó.")
    const existing = await ctx.scoped.waitlistEntries.findFirst(
      and(
        eq(schema.waitlistEntries.customerId, ctx.customer.id),
        eq(schema.waitlistEntries.serviceId, service.id),
        eq(schema.waitlistEntries.date, input.date),
        eq(schema.waitlistEntries.status, "waiting"),
      ),
    )
    if (!existing) {
      await ctx.scoped.waitlistEntries.insert({
        customerId: ctx.customer.id,
        serviceId: service.id,
        resourceId: input.staff_id ?? null,
        date: input.date,
        fromTime: input.from_time ?? null,
        toTime: input.to_time ?? null,
      })
    }
    return {
      added: !existing,
      already_waiting: Boolean(existing),
      service: service.name,
      date: input.date,
      hint: "Si se libera un lugar ese día, le llega un mensaje con un botón para tomarlo; es para quien conteste primero.",
    }
  },
})
