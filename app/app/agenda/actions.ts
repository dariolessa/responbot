"use server"

import { and, desc, eq, ilike, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getTenant, type Tenant } from "@/lib/auth/tenant"
import { can } from "@/lib/auth/roles"
import {
  agendaAccess,
  canSeeCustomer,
  canUseResource,
  customersVisibleWhere,
  realCustomersWhere,
  type AgendaAccess,
} from "@/lib/booking/access"
import {
  BookingError,
  changeBookingStatus,
  createBooking,
  moveBooking,
  type Actor,
} from "@/lib/booking/create"
import { findSlots } from "@/lib/booking/slots"
import { flushSoon } from "@/lib/notifications/deps"
import * as schema from "@/lib/db/schema"
import { dateInput, fail, invalid, ok, timeInput, type ActionResult } from "@/lib/forms"
import { formatPhone, normalizePhone } from "@/lib/phone"
import { addDaysToDate, formatZoned, toTimeString, zonedToUtc } from "@/lib/time"

/*
 * Acciones de la agenda. Todas revisan en el servidor que la columna (el
 * profesional) sea visible para quien la usa: un profesional solo toca la suya.
 */

async function context(): Promise<{ tenant: Tenant; access: AgendaAccess; actor: Actor; timezone: string }> {
  const tenant = await getTenant()
  const access = await agendaAccess(tenant)
  return {
    tenant,
    access,
    actor: { type: "user", id: tenant.user.id, channel: "panel" },
    timezone: tenant.business.timezone,
  }
}

function bookingFailure(error: unknown) {
  if (error instanceof BookingError) return fail(error.message)
  throw error
}

function done(tenant?: Tenant) {
  // Después de tocar un turno: confirmación o cancelación al cliente y avisos al equipo, sin demorar la respuesta.
  if (tenant) flushSoon(tenant.business.businessId)
  revalidatePath("/app/agenda")
  revalidatePath("/app/clientes", "layout")
}

// ---------------------------------------------------------------------------
// Horarios libres y clientes
// ---------------------------------------------------------------------------

const slotsInput = z.object({
  serviceId: z.uuid(),
  resourceId: z.uuid().nullable(),
  date: dateInput,
})

export type SlotOption = { resourceId: string; startsAt: string; time: string }

export async function getSlots(input: z.input<typeof slotsInput>): Promise<ActionResult<SlotOption[]>> {
  const { tenant, access, timezone } = await context()
  const parsed = slotsInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (parsed.data.resourceId && !canUseResource(access, parsed.data.resourceId)) {
    return fail("No podés dar turnos en esa agenda.")
  }
  const slots = await findSlots(tenant.db, {
    serviceId: parsed.data.serviceId,
    resourceId: parsed.data.resourceId ?? undefined,
    allowedResourceIds: access.all ? undefined : access.resourceIds,
    from: parsed.data.date,
    ignoreBookingWindow: true,
  })
  return ok(
    slots.map((s) => ({
      resourceId: s.resourceId,
      startsAt: s.startsAt.toISOString(),
      time: toTimeString(s.startsAt, timezone),
    })),
  )
}

export type CustomerOption = { id: string; name: string | null; phone: string; noShowCount: number }

export async function searchCustomers(input: { q: string }): Promise<ActionResult<CustomerOption[]>> {
  const { tenant, access } = await context()
  const q = z.string().trim().max(60).parse(input.q)
  if (q.length < 2) return ok([])
  const digits = q.replace(/\D/g, "")
  const rows = await tenant.db.customers.findMany({
    where: and(
      or(
        ilike(schema.customers.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
        digits.length >= 3 ? ilike(schema.customers.phoneE164, `%${digits}%`) : undefined,
        // "099…": sin el 0 inicial también coincide con el E.164.
        digits.length >= 4 ? ilike(schema.customers.phoneE164, `%${digits.replace(/^0+/, "")}%`) : undefined,
      ),
      customersVisibleWhere(access),
      realCustomersWhere(),
    ),
    orderBy: [desc(schema.customers.updatedAt)],
    limit: 8,
  })
  return ok(
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: formatPhone(c.phoneE164),
      noShowCount: c.noShowCount,
    })),
  )
}

// ---------------------------------------------------------------------------
// Reserva manual
// ---------------------------------------------------------------------------

const createInput = z.object({
  serviceId: z.uuid({ error: "Elegí un servicio." }),
  resourceId: z.uuid().nullable(),
  date: dateInput,
  time: timeInput,
  customer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), id: z.uuid({ error: "Elegí un cliente." }) }),
    z.object({
      kind: z.literal("new"),
      name: z
        .string()
        .trim()
        .min(2, { error: "Escribí el nombre del cliente." })
        .max(80, { error: "El nombre es muy largo." }),
      phone: z.string().trim().min(6, { error: "Escribí el teléfono del cliente." }),
    }),
  ]),
})

export type CreateBookingInput = z.input<typeof createInput>

export async function createBookingAction(input: CreateBookingInput): Promise<ActionResult<{ id: string }>> {
  const { tenant, access, actor, timezone } = await context()
  const parsed = createInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { serviceId, date, time, customer } = parsed.data
  const startsAt = zonedToUtc(date, time, timezone)

  let resourceId = parsed.data.resourceId
  if (resourceId && !canUseResource(access, resourceId)) return fail("No podés dar turnos en esa agenda.")
  if (!resourceId) {
    // "Cualquiera": el primer profesional libre a esa hora.
    const slots = await findSlots(tenant.db, {
      serviceId,
      allowedResourceIds: access.all ? undefined : access.resourceIds,
      from: date,
      ignoreBookingWindow: true,
    })
    const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime())
    if (!slot) return fail("No hay nadie libre a esa hora. Elegí otro horario o un profesional.")
    resourceId = slot.resourceId
  }

  let customerId: string
  if (customer.kind === "existing") {
    if (!(await canSeeCustomer(tenant.db, access, customer.id))) return fail("No encontramos a ese cliente.")
    customerId = customer.id
  } else {
    const phone = normalizePhone(customer.phone, timezone)
    if (!phone) {
      return fail("Revisá el teléfono.", { "customer.phone": "Escribí un teléfono válido, por ejemplo 099 123 456." })
    }
    // Si el teléfono ya existe, es el mismo cliente (el teléfono es único por negocio).
    const existing = await tenant.db.customers.findFirst(eq(schema.customers.phoneE164, phone))
    if (existing) {
      customerId = existing.id
      if (!existing.name) {
        await tenant.db.customers.update(eq(schema.customers.id, existing.id), { name: customer.name })
      }
    } else {
      const [created] = await tenant.db.customers.insert({ phoneE164: phone, name: customer.name })
      customerId = created!.id
    }
  }

  try {
    const booking = await createBooking(
      tenant.db,
      { customerId, resourceId, serviceId, startsAt, source: "panel" },
      actor,
    )
    done(tenant)
    return ok({ id: booking.id })
  } catch (error) {
    return bookingFailure(error)
  }
}

// ---------------------------------------------------------------------------
// Mover, cambiar de estado y ver el detalle
// ---------------------------------------------------------------------------

async function visibleBooking(tenant: Tenant, access: AgendaAccess, bookingId: string) {
  const booking = await tenant.db.bookings.findById(bookingId)
  if (!booking || !canUseResource(access, booking.resourceId)) return null
  return booking
}

const moveInput = z.object({
  bookingId: z.uuid(),
  date: dateInput,
  time: timeInput,
  resourceId: z.uuid().optional(),
})

export async function moveBookingAction(input: z.input<typeof moveInput>): Promise<ActionResult> {
  const { tenant, access, actor, timezone } = await context()
  const parsed = moveInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const booking = await visibleBooking(tenant, access, parsed.data.bookingId)
  if (!booking) return fail("No encontramos el turno.")
  if (parsed.data.resourceId && !canUseResource(access, parsed.data.resourceId)) {
    return fail("No podés mover turnos a esa agenda.")
  }
  try {
    await moveBooking(
      tenant.db,
      {
        bookingId: booking.id,
        startsAt: zonedToUtc(parsed.data.date, parsed.data.time, timezone),
        resourceId: parsed.data.resourceId,
      },
      actor,
    )
    done(tenant)
    return ok()
  } catch (error) {
    return bookingFailure(error)
  }
}

const statusInput = z.object({
  bookingId: z.uuid(),
  to: z.enum(["confirmed", "client_confirmed", "completed", "no_show", "cancelled"]),
  reason: z.string().trim().max(200).optional(),
})

export async function changeStatusAction(input: z.input<typeof statusInput>): Promise<ActionResult> {
  const { tenant, access, actor } = await context()
  const parsed = statusInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const booking = await visibleBooking(tenant, access, parsed.data.bookingId)
  if (!booking) return fail("No encontramos el turno.")
  try {
    await changeBookingStatus(
      tenant.db,
      { bookingId: booking.id, to: parsed.data.to, cancelReason: parsed.data.reason },
      actor,
    )
    done(tenant)
    return ok()
  } catch (error) {
    return bookingFailure(error)
  }
}

export type BookingHistoryItem = {
  id: string
  fromStatus: schema.BookingEvent["fromStatus"]
  toStatus: schema.BookingEvent["toStatus"]
  actor: string
  channel: schema.BookingEvent["channel"]
  /** Fecha y hora en la zona del negocio. */
  at: string
}

export async function getBookingHistory(input: { bookingId: string }): Promise<ActionResult<BookingHistoryItem[]>> {
  const { tenant, access, timezone } = await context()
  const bookingId = z.uuid().parse(input.bookingId)
  if (!(await visibleBooking(tenant, access, bookingId))) return fail("No encontramos el turno.")

  const [events, members] = await Promise.all([
    tenant.db.bookingEvents.findMany({
      where: eq(schema.bookingEvents.bookingId, bookingId),
      orderBy: [schema.bookingEvents.createdAt],
    }),
    tenant.db.members(),
  ])
  const actorLabel = (e: schema.BookingEvent) => {
    if (e.actorType === "bot") return "El bot"
    if (e.actorType === "customer") return "El cliente"
    if (e.actorType === "system") return "Automático"
    const member = members.find((m) => m.userId === e.actorId)
    if (!member) return "Alguien del equipo"
    return member.userId === tenant.user.id ? "Vos" : (member.name ?? member.email ?? "Alguien del equipo")
  }
  return ok(
    events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: actorLabel(e),
      channel: e.channel,
      at: formatZoned(e.createdAt, timezone, "d/MM HH:mm"),
    })),
  )
}

// ---------------------------------------------------------------------------
// Bloqueos (vacaciones, almuerzo, feriados)
// ---------------------------------------------------------------------------

const timeOffInput = z
  .object({
    resourceId: z.uuid().nullable(),
    allDay: z.boolean(),
    startDate: dateInput,
    startTime: timeInput.optional(),
    endDate: dateInput,
    endTime: timeInput.optional(),
    reason: z
      .string()
      .trim()
      .max(80, { error: "El motivo es muy largo." })
      .optional()
      .transform((v) => v || null),
  })
  .refine((v) => v.allDay || (v.startTime && v.endTime), {
    error: "Elegí desde y hasta qué hora.",
    path: ["endTime"],
  })

export async function createTimeOff(input: z.input<typeof timeOffInput>): Promise<ActionResult> {
  const { tenant, access, timezone } = await context()
  const parsed = timeOffInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  if (v.resourceId === null && !can(tenant.role, "manageBusinessSettings")) {
    return fail("Solo el dueño o un admin bloquean todo el negocio.")
  }
  if (v.resourceId && !canUseResource(access, v.resourceId)) return fail("No podés bloquear esa agenda.")
  if (v.resourceId && !(await tenant.db.resources.findById(v.resourceId))) {
    return fail("Ese profesional ya no existe.")
  }

  const startsAt = zonedToUtc(v.startDate, v.allDay ? "00:00" : v.startTime!, timezone)
  const endsAt = v.allDay
    ? zonedToUtc(addDaysToDate(v.endDate, 1), "00:00", timezone)
    : zonedToUtc(v.endDate, v.endTime!, timezone)
  if (endsAt <= startsAt) {
    return fail("El bloqueo tiene que terminar después de empezar.", {
      endDate: "Tiene que ser después del inicio.",
    })
  }
  await tenant.db.timeOff.insert({ resourceId: v.resourceId, startsAt, endsAt, reason: v.reason })
  done()
  return ok()
}

export async function deleteTimeOff(input: { id: string }): Promise<ActionResult> {
  const { tenant, access } = await context()
  const id = z.uuid().parse(input.id)
  const block = await tenant.db.timeOff.findById(id)
  if (!block) return ok()
  if (block.resourceId === null ? !can(tenant.role, "manageBusinessSettings") : !canUseResource(access, block.resourceId)) {
    return fail("No podés quitar ese bloqueo.")
  }
  await tenant.db.timeOff.delete(eq(schema.timeOff.id, id))
  done()
  return ok()
}
