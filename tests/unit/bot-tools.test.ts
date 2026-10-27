import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { getTestConversation } from "@/lib/bot/test-chat"
import { apiTools, botTools, runTool, type ToolContext } from "@/lib/bot/tools"
import { createBooking } from "@/lib/booking/create"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatMoney } from "@/lib/money"
import { toTimeString } from "@/lib/time"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon, TZ } from "../helpers/bot"

/*
 * Herramientas del bot contra un Postgres real (PGlite): leen y escriben con
 * las mismas reglas que el panel y nunca salen del negocio de la conversación.
 */

// Lunes 2 de noviembre de 2026, 10:00 en Montevideo.
const NOW = new Date("2026-11-02T13:00:00Z")

let db: TestDb
let close: () => Promise<void>
let salon: Awaited<ReturnType<typeof seedSalon>>
let other: Awaited<ReturnType<typeof seedSalon>>
let ctx: ToolContext

async function contextFor(scoped: ScopedDb, userId: string, overrides: Partial<ToolContext> = {}) {
  const { customer, conversation } = await getTestConversation(scoped, userId)
  return {
    scoped,
    business: (await scoped.business())!,
    rules: await scoped.bookingRules.findFirst(),
    settings: await scoped.botSettings.findFirst(),
    customer,
    conversation,
    channel: "test_chat",
    now: NOW,
    canBook: true,
    ...overrides,
  } satisfies ToolContext
}

async function call(name: string, input: Record<string, unknown>, context = ctx) {
  return runTool(name, input, context) as Promise<{ ok: boolean; output: Record<string, unknown> & { error?: string } }>
}

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  salon = await seedSalon(db, "sol")
  other = await seedSalon(db, "otra")
  ctx = await contextFor(salon.scoped, salon.owner.id)
})

afterAll(async () => {
  await close()
})

describe("definiciones", () => {
  it("expone las once herramientas del SPEC con JSON Schema de objeto", () => {
    expect(apiTools.map((t) => t.name)).toEqual([
      "list_services",
      "list_staff",
      "check_availability",
      "create_booking",
      "get_customer_bookings",
      "reschedule_booking",
      "cancel_booking",
      "join_waitlist",
      "get_business_info",
      "save_customer_name",
      "handoff_to_human",
    ])
    for (const tool of apiTools) {
      expect(tool.input_schema.type).toBe("object")
      expect(tool.input_schema).not.toHaveProperty("$schema")
      expect(tool.description?.length ?? 0).toBeGreaterThan(20)
    }
    const availability = apiTools.find((t) => t.name === "check_availability")!
    expect(availability.input_schema.required).toEqual(["service_id", "date_from"])
    expect(botTools).toHaveLength(11)
  })

  it("rechaza entradas inválidas sin ejecutar nada", async () => {
    const result = await call("check_availability", { service_id: "corte", date_from: "mañana" })
    expect(result.ok).toBe(false)
    expect(result.output.error).toBe("Datos inválidos.")
  })

  it("avisa si la herramienta no existe", async () => {
    const result = await call("borrar_todo", {})
    expect(result.ok).toBe(false)
  })
})

describe("consultas", () => {
  it("list_services trae precio, duración y quién lo hace", async () => {
    const { output } = await call("list_services", {})
    const services = output.services as { name: string; price: string; duration: string; staff: { name: string }[] }[]
    expect(services.map((s) => s.name)).toEqual(["Corte", "Color"])
    expect(services[0]).toMatchObject({ price: formatMoney(60000, "UYU"), duration: "30 min" })
    expect(services[0]!.staff.map((s) => s.name)).toEqual(["Ana", "Beto"])
    expect(services[1]!.staff.map((s) => s.name)).toEqual(["Ana"])
  })

  it("get_business_info trae dirección, horario unido y preguntas frecuentes", async () => {
    await salon.scoped.botSettings.update(undefined, {
      faq: [{ question: "¿Aceptan tarjeta?", answer: "Sí, débito y crédito." }],
    })
    const { output } = await call("get_business_info", {}, await contextFor(salon.scoped, salon.owner.id))
    expect(output.address).toBe("Bulevar Artigas 1234")
    expect(output.opening_hours).toContainEqual({ day: "Lunes", hours: "09:00 a 13:00 y 15:00 a 19:00" })
    expect(output.opening_hours).toContainEqual({ day: "Domingo", hours: "cerrado" })
    expect(output.faq).toEqual([{ question: "¿Aceptan tarjeta?", answer: "Sí, débito y crédito." }])
  })
})

describe("check_availability", () => {
  it("respeta la anticipación mínima y ofrece los más cercanos", async () => {
    const { ok, output } = await call("check_availability", {
      service_id: salon.corte.id,
      date_from: "2026-11-02",
    })
    expect(ok).toBe(true)
    const slots = output.slots as { time: string; staff_name: string; date: string }[]
    // Ahora son las 10:00 y hay que reservar con 60 minutos: el primero es a las 11:00.
    expect(slots[0]).toMatchObject({ date: "2026-11-02", time: "11:00", staff_name: "Ana" })
    expect(slots.length).toBeLessThanOrEqual(6)
    expect(output.more_available).toBe(true)
  })

  it("filtra por profesional y por franja", async () => {
    const { output } = await call("check_availability", {
      service_id: salon.corte.id,
      staff_id: salon.beto.id,
      date_from: "2026-11-03",
      from_time: "15:00",
    })
    const slots = output.slots as { time: string; staff_name: string }[]
    expect(slots[0]).toMatchObject({ time: "15:00", staff_name: "Beto" })
    expect(slots.every((s) => s.staff_name === "Beto" && s.time >= "15:00")).toBe(true)
  })

  it("un domingo sin horario devuelve el próximo día con lugar", async () => {
    const { output } = await call("check_availability", {
      service_id: salon.corte.id,
      date_from: "2026-11-08",
    })
    expect(output.available).toBe(false)
    expect(output.next_available_date).toBe("2026-11-09")
  })

  it("no busca en el pasado ni más de 7 días", async () => {
    const { output } = await call("check_availability", {
      service_id: salon.color.id,
      date_from: "2026-10-01",
      date_to: "2026-12-30",
    })
    const dates = new Set((output.slots as { date: string }[]).map((s) => s.date))
    expect([...dates].every((d) => d >= "2026-11-02" && d <= "2026-11-08")).toBe(true)
  })

  it("no ve servicios de otro negocio", async () => {
    const result = await call("check_availability", { service_id: other.corte.id, date_from: "2026-11-03" })
    expect(result.ok).toBe(false)
  })
})

describe("reservas", () => {
  let bookingId: string

  it("create_booking reserva un horario libre con origen chat de prueba", async () => {
    const { ok, output } = await call("create_booking", {
      service_id: salon.corte.id,
      staff_id: salon.ana.id,
      date: "2026-11-04",
      time: "09:30",
    })
    expect(ok).toBe(true)
    expect(output).toMatchObject({ created: true, staff: "Ana", time: "09:30", price: formatMoney(60000, "UYU") })
    bookingId = output.booking_id as string
    const booking = await salon.scoped.bookings.findById(bookingId)
    expect(booking).toMatchObject({ source: "test_chat", status: "confirmed", customerId: ctx.customer.id })
    const [event] = await salon.scoped.bookingEvents.findMany({
      where: eq(schema.bookingEvents.bookingId, bookingId),
    })
    expect(event).toMatchObject({ actorType: "bot", channel: "panel" })
  })

  it("sin profesional elegido asigna el primero libre", async () => {
    const { output } = await call("create_booking", {
      service_id: salon.corte.id,
      date: "2026-11-04",
      time: "09:30",
    })
    // Ana ya está ocupada a esa hora.
    expect(output).toMatchObject({ created: true, staff: "Beto" })
    await salon.scoped.bookings.update(eq(schema.bookings.id, output.booking_id as string), {
      status: "cancelled",
    })
  })

  it("no reserva un horario ocupado ni fuera de las reglas", async () => {
    const taken = await call("create_booking", {
      service_id: salon.corte.id,
      staff_id: salon.ana.id,
      date: "2026-11-04",
      time: "09:30",
    })
    expect(taken.ok).toBe(false)
    const tooSoon = await call("create_booking", {
      service_id: salon.corte.id,
      staff_id: salon.ana.id,
      date: "2026-11-02",
      time: "10:15",
    })
    expect(tooSoon.ok).toBe(false)
    const closed = await call("create_booking", {
      service_id: salon.corte.id,
      staff_id: salon.ana.id,
      date: "2026-11-04",
      time: "13:30",
    })
    expect(closed.ok).toBe(false)
  })

  it("con la prueba vencida no reserva", async () => {
    const result = await call(
      "create_booking",
      { service_id: salon.corte.id, date: "2026-11-05", time: "09:00" },
      { ...ctx, canBook: false },
    )
    expect(result.ok).toBe(false)
    expect(result.output.error).toMatch(/no está tomando reservas/)
  })

  it("get_customer_bookings lista solo los turnos de este cliente", async () => {
    const [someone] = await salon.scoped.customers.insert({ phoneE164: "+59899000111", name: "Otra" })
    await createBooking(
      salon.scoped,
      {
        customerId: someone!.id,
        resourceId: salon.beto.id,
        serviceId: salon.corte.id,
        startsAt: new Date("2026-11-04T15:00:00Z"),
        source: "panel",
      },
      { type: "user", id: null, channel: "panel" },
    )
    const { output } = await call("get_customer_bookings", {})
    const bookings = output.bookings as { booking_id: string }[]
    expect(bookings.map((b) => b.booking_id)).toEqual([bookingId])
  })

  it("reschedule_booking mueve dentro de la política, aunque se pise con su propio horario", async () => {
    const { ok, output } = await call("reschedule_booking", {
      booking_id: bookingId,
      date: "2026-11-04",
      time: "09:45",
    })
    expect(ok).toBe(true)
    expect(output).toMatchObject({ moved: true, time: "09:45", staff: "Ana" })
    const booking = await salon.scoped.bookings.findById(bookingId)
    expect(toTimeString(booking!.startsAt, TZ)).toBe("09:45")
  })

  it("no mueve con menos anticipación que la política", async () => {
    const soon = await createBooking(
      salon.scoped,
      {
        customerId: ctx.customer.id,
        resourceId: salon.beto.id,
        serviceId: salon.corte.id,
        startsAt: new Date("2026-11-02T18:00:00Z"),
        source: "test_chat",
      },
      { type: "bot", id: null, channel: "panel" },
    )
    const result = await call("reschedule_booking", { booking_id: soon.id, date: "2026-11-05", time: "09:00" })
    expect(result.ok).toBe(false)
    expect(result.output.error).toMatch(/menos de 24 horas/)

    // Cancelar sí se puede, avisando que es fuera de plazo.
    const cancelled = await call("cancel_booking", { booking_id: soon.id })
    expect(cancelled.output).toMatchObject({ cancelled: true, late_cancellation: true })
    expect((await salon.scoped.bookings.findById(soon.id))!.status).toBe("cancelled")
  })

  it("no toca turnos de otro cliente ni de otro negocio", async () => {
    const [foreign] = await salon.scoped.bookings.findMany({
      where: eq(schema.bookings.resourceId, salon.beto.id),
    })
    const notOwn = await call("cancel_booking", { booking_id: foreign!.id })
    expect(notOwn.ok).toBe(false)

    const otherCtx = await contextFor(other.scoped, other.owner.id)
    const crossTenant = await call("cancel_booking", { booking_id: bookingId }, otherCtx)
    expect(crossTenant.ok).toBe(false)
    expect((await salon.scoped.bookings.findById(bookingId))!.status).toBe("confirmed")
  })

  it("cancel_booking dentro del plazo", async () => {
    const { output } = await call("cancel_booking", { booking_id: bookingId, reason: "Me surgió algo" })
    expect(output).toMatchObject({ cancelled: true, late_cancellation: false })
    const booking = await salon.scoped.bookings.findById(bookingId)
    expect(booking).toMatchObject({ status: "cancelled", cancelReason: "Me surgió algo" })
  })
})

describe("cliente y derivación", () => {
  it("join_waitlist anota una sola vez por día y servicio", async () => {
    const first = await call("join_waitlist", { service_id: salon.color.id, date: "2026-11-06" })
    const second = await call("join_waitlist", { service_id: salon.color.id, date: "2026-11-06" })
    expect(first.output).toMatchObject({ added: true })
    expect(second.output).toMatchObject({ added: false, already_waiting: true })
    expect(await salon.scoped.waitlistEntries.count()).toBe(1)
  })

  it("save_customer_name guarda nombre y preferencia", async () => {
    const context = await contextFor(salon.scoped, salon.owner.id)
    await call("save_customer_name", { name: "Lucía", preference: "prefiere a Ana" }, context)
    expect(context.customer.name).toBe("Lucía")
    const customer = await salon.scoped.customers.findById(context.customer.id)
    expect(customer).toMatchObject({ name: "Lucía", notes: "Dijo por chat: prefiere a Ana" })
  })

  it("handoff_to_human pasa a modo humano y avisa al dueño", async () => {
    const context = await contextFor(salon.scoped, salon.owner.id)
    const { output } = await call("handoff_to_human", { reason: "Quiere hablar con alguien" }, context)
    expect(output.handed_off).toBe(true)
    expect(context.conversation.mode).toBe("human")
    const [notification] = await salon.scoped.notifications.findMany()
    expect(notification).toMatchObject({ userId: salon.owner.id, type: "conversation.handoff" })
    expect(await other.scoped.notifications.count()).toBe(0)
  })
})
