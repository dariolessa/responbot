import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  BookingError,
  changeBookingStatus,
  createBooking,
  moveBooking,
  type Actor,
} from "@/lib/booking/create"
import { findSlots } from "@/lib/booking/slots"
import { createService, createStaff, setResourceServices } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { forBusiness, forUser, type ScopedDb } from "@/lib/db/scoped"
import { toTimeString } from "@/lib/time"
import { createTestDb, type TestDb } from "../helpers/db"

/*
 * Reserva manual, movimientos y estados contra un Postgres real (PGlite) con
 * la exclusión gist de la migración.
 */

const TZ = "America/Montevideo"
const at = (iso: string) => new Date(iso)

let db: TestDb
let close: () => Promise<void>
let scoped: ScopedDb
let other: ScopedDb
let actor: Actor
let ana: schema.Resource
let beto: schema.Resource
let corte: schema.Service
let color: schema.Service
let customerId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  const [owner] = await db.insert(schema.users).values({ email: "duena@example.com" }).returning()
  const business = await forUser(db, owner!.id).createBusiness({
    name: "Peluquería Sol",
    slug: "peluqueria-sol",
    archetype: "services",
    timezone: TZ,
    currency: "UYU",
    trialEndsAt: at("2026-12-01T00:00:00Z"),
  })
  scoped = forBusiness(db, business.id)
  actor = { type: "user", id: owner!.id, channel: "panel" }

  corte = await createService(scoped, {
    name: "Corte",
    description: null,
    durationMinutes: 30,
    price: 60000,
  })
  color = await createService(scoped, {
    name: "Color",
    description: null,
    durationMinutes: 90,
    price: 180000,
  })
  const hours = [{ weekday: 1, startTime: "09:00", endTime: "13:00" }]
  ana = await createStaff(scoped, { name: "Ana", serviceIds: [corte.id, color.id], hours })
  beto = await createStaff(scoped, { name: "Beto", serviceIds: [corte.id], hours })
  // Beto cobra distinto el corte y tarda más.
  await scoped.resourceServices.update(eq(schema.resourceServices.resourceId, beto.id), {
    customPrice: 70000,
    customDuration: 45,
  })
  const [customer] = await scoped.customers.insert({ phoneE164: "+59899123456", name: "Lucía" })
  customerId = customer!.id

  const [otherOwner] = await db.insert(schema.users).values({ email: "otro@example.com" }).returning()
  const otherBusiness = await forUser(db, otherOwner!.id).createBusiness({
    name: "Otro",
    slug: "otro",
    archetype: "services",
    timezone: TZ,
    currency: "UYU",
    trialEndsAt: at("2026-12-01T00:00:00Z"),
  })
  other = forBusiness(db, otherBusiness.id)
})

afterAll(async () => {
  await close()
})

describe("createBooking", () => {
  it("crea un turno confirmado con precio y duración del profesional, y su evento", async () => {
    const booking = await createBooking(
      scoped,
      {
        customerId,
        resourceId: beto.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T12:00:00Z"),
        source: "panel",
      },
      actor,
    )
    expect(booking.status).toBe("confirmed")
    expect(booking.price).toBe(70000)
    expect(booking.currency).toBe("UYU")
    expect(booking.endsAt.toISOString()).toBe("2026-11-02T12:45:00.000Z")
    const events = await scoped.bookingEvents.findMany({
      where: eq(schema.bookingEvents.bookingId, booking.id),
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "confirmed", channel: "panel" })
  })

  it("rechaza un horario ocupado con un mensaje claro", async () => {
    const attempt = createBooking(
      scoped,
      {
        customerId,
        resourceId: beto.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T12:30:00Z"),
        source: "panel",
      },
      actor,
    )
    await expect(attempt).rejects.toBeInstanceOf(BookingError)
    await expect(attempt).rejects.toThrow(/ocupado/)
  })

  it("rechaza un servicio que el profesional no hace", async () => {
    await expect(
      createBooking(
        scoped,
        {
          customerId,
          resourceId: beto.id,
          serviceId: color.id,
          startsAt: at("2026-11-02T15:00:00Z"),
          source: "panel",
        },
        actor,
      ),
    ).rejects.toThrow(/no hace/)
  })

  it("rechaza un horario bloqueado", async () => {
    await scoped.timeOff.insert({
      resourceId: ana.id,
      startsAt: at("2026-11-09T12:00:00Z"),
      endsAt: at("2026-11-09T16:00:00Z"),
      reason: "Trámite",
    })
    await expect(
      createBooking(
        scoped,
        {
          customerId,
          resourceId: ana.id,
          serviceId: corte.id,
          startsAt: at("2026-11-09T13:00:00Z"),
          source: "panel",
        },
        actor,
      ),
    ).rejects.toThrow(/bloqueado \(Trámite\)/)
  })

  it("no ve clientes de otro negocio", async () => {
    await expect(
      createBooking(
        other,
        {
          customerId,
          resourceId: ana.id,
          serviceId: corte.id,
          startsAt: at("2026-11-02T13:00:00Z"),
          source: "panel",
        },
        actor,
      ),
    ).rejects.toThrow(/cliente/)
  })
})

describe("findSlots", () => {
  it("descuenta turnos y usa la duración de cada profesional", async () => {
    const slots = await findSlots(scoped, {
      serviceId: corte.id,
      resourceId: beto.id,
      from: "2026-11-02",
      now: at("2026-10-27T12:00:00Z"),
    })
    // Beto tiene 09:00–09:45 ocupado; el corte le lleva 45 minutos y el paso es 15.
    expect(slots.map((s) => toTimeString(s.startsAt, TZ)).slice(0, 3)).toEqual([
      "09:45",
      "10:00",
      "10:15",
    ])
    expect(slots.at(-1) && toTimeString(slots.at(-1)!.startsAt, TZ)).toBe("12:15")
  })

  it("con cualquier profesional, un horario por inicio", async () => {
    const slots = await findSlots(scoped, {
      serviceId: corte.id,
      from: "2026-11-02",
      now: at("2026-10-27T12:00:00Z"),
    })
    const first = slots[0]!
    expect(toTimeString(first.startsAt, TZ)).toBe("09:00")
    expect(first.resourceId).toBe(ana.id)
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(slots.length)
  })

  it("respeta los profesionales permitidos", async () => {
    const slots = await findSlots(scoped, {
      serviceId: color.id,
      allowedResourceIds: [beto.id],
      from: "2026-11-02",
      now: at("2026-10-27T12:00:00Z"),
    })
    expect(slots).toEqual([])
  })
})

describe("moveBooking y changeBookingStatus", () => {
  let bookingId: string

  beforeAll(async () => {
    const booking = await createBooking(
      scoped,
      {
        customerId,
        resourceId: ana.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T14:00:00Z"),
        source: "panel",
      },
      actor,
    )
    bookingId = booking.id
  })

  it("mueve a otro horario y otro profesional, con su precio", async () => {
    const moved = await moveBooking(
      scoped,
      { bookingId, startsAt: at("2026-11-02T14:30:00Z"), resourceId: beto.id },
      actor,
    )
    expect(moved.resourceId).toBe(beto.id)
    expect(moved.price).toBe(70000)
    expect(moved.endsAt.toISOString()).toBe("2026-11-02T15:15:00.000Z")
  })

  it("no mueve sobre otro turno", async () => {
    await expect(
      moveBooking(scoped, { bookingId, startsAt: at("2026-11-02T12:15:00Z") }, actor),
    ).rejects.toThrow(/ocupado/)
  })

  it("marca atendido, actualiza al cliente y ya no deja moverlo", async () => {
    const done = await changeBookingStatus(scoped, { bookingId, to: "completed" }, actor)
    expect(done.status).toBe("completed")
    const customer = await scoped.customers.findById(customerId)
    expect(customer!.lastVisitAt?.toISOString()).toBe("2026-11-02T14:30:00.000Z")

    await expect(
      moveBooking(scoped, { bookingId, startsAt: at("2026-11-02T16:00:00Z") }, actor),
    ).rejects.toThrow(/no se puede mover/)
    await expect(
      changeBookingStatus(scoped, { bookingId, to: "cancelled" }, actor),
    ).rejects.toThrow(/No se puede pasar/)
  })

  it("cuenta inasistencias y guarda el motivo de cancelación", async () => {
    const a = await createBooking(
      scoped,
      {
        customerId,
        resourceId: ana.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T15:30:00Z"),
        source: "panel",
      },
      actor,
    )
    await changeBookingStatus(scoped, { bookingId: a.id, to: "no_show" }, actor)
    expect((await scoped.customers.findById(customerId))!.noShowCount).toBe(1)

    const b = await createBooking(
      scoped,
      {
        customerId,
        resourceId: ana.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T16:00:00Z"),
        source: "panel",
      },
      actor,
    )
    const cancelled = await changeBookingStatus(
      scoped,
      { bookingId: b.id, to: "cancelled", cancelReason: "  Se enfermó " },
      actor,
    )
    expect(cancelled.cancelReason).toBe("Se enfermó")
    // El horario cancelado queda libre.
    const again = await createBooking(
      scoped,
      {
        customerId,
        resourceId: ana.id,
        serviceId: corte.id,
        startsAt: at("2026-11-02T16:00:00Z"),
        source: "panel",
      },
      actor,
    )
    expect(again.status).toBe("confirmed")
  })
})

describe("catálogo", () => {
  it("cambiar los servicios de un profesional conserva precios propios", async () => {
    await setResourceServices(scoped, beto.id, [corte.id, color.id])
    const links = await scoped.resourceServices.findMany({
      where: eq(schema.resourceServices.resourceId, beto.id),
    })
    expect(links).toHaveLength(2)
    expect(links.find((l) => l.serviceId === corte.id)!.customPrice).toBe(70000)

    await setResourceServices(scoped, beto.id, [color.id])
    expect(
      await scoped.resourceServices.count(eq(schema.resourceServices.resourceId, beto.id)),
    ).toBe(1)
  })
})
