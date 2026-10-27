import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  agendaAccess,
  bookingsVisibleWhere,
  canSeeCustomer,
  canUseResource,
  customersVisibleWhere,
} from "@/lib/booking/access"
import { createBooking } from "@/lib/booking/create"
import { createService, createStaff } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { forBusiness, forUser, type ScopedDb } from "@/lib/db/scoped"
import { createTestDb, type TestDb } from "../helpers/db"

/*
 * Un profesional ve y gestiona solo su agenda y sus clientes (docs/SPEC.md,
 * "Roles"); dueño y admin ven todo.
 */

let db: TestDb
let close: () => Promise<void>
let scoped: ScopedDb
let ownerId: string
let staffUserId: string
let mine: schema.Resource
let theirs: schema.Resource
let myCustomer: string
let otherCustomer: string

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  const [owner] = await db.insert(schema.users).values({ email: "duena@example.com" }).returning()
  ownerId = owner!.id
  const business = await forUser(db, ownerId).createBusiness({
    name: "Uñas Centro",
    slug: "unas-centro",
    archetype: "services",
    timezone: "America/Montevideo",
    currency: "UYU",
    trialEndsAt: new Date("2026-12-01T00:00:00Z"),
  })
  scoped = forBusiness(db, business.id)

  const service = await createService(scoped, {
    name: "Kapping",
    description: null,
    durationMinutes: 60,
    price: 110000,
  })
  const hours = [{ weekday: 1, startTime: "09:00", endTime: "18:00" }]
  mine = await createStaff(scoped, { name: "Sofi", serviceIds: [service.id], hours })
  theirs = await createStaff(scoped, { name: "Dueña", userId: ownerId, serviceIds: [service.id], hours })

  // Sofi entra por invitación y su columna queda vinculada.
  await scoped.invitations.insert({
    email: "sofi@example.com",
    role: "staff",
    tokenHash: "hash-sofi",
    resourceId: mine.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  const [staffUser] = await db.insert(schema.users).values({ email: "sofi@example.com" }).returning()
  staffUserId = staffUser!.id
  await forUser(db, staffUserId).acceptPendingInvitations("sofi@example.com")

  const [a] = await scoped.customers.insert({ phoneE164: "+59899000001", name: "Clienta de Sofi" })
  const [b] = await scoped.customers.insert({ phoneE164: "+59899000002", name: "Clienta de la dueña" })
  myCustomer = a!.id
  otherCustomer = b!.id
  const actor = { type: "user" as const, id: ownerId, channel: "panel" as const }
  await createBooking(
    scoped,
    {
      customerId: myCustomer,
      resourceId: mine.id,
      serviceId: service.id,
      startsAt: new Date("2026-11-02T12:00:00Z"),
      source: "panel",
    },
    actor,
  )
  await createBooking(
    scoped,
    {
      customerId: otherCustomer,
      resourceId: theirs.id,
      serviceId: service.id,
      startsAt: new Date("2026-11-02T12:00:00Z"),
      source: "panel",
    },
    actor,
  )
})

afterAll(async () => {
  await close()
})

describe("invitación con profesional", () => {
  it("al aceptarla, la columna de la agenda pasa a ser de esa persona", async () => {
    expect((await scoped.resources.findById(mine.id))!.userId).toBe(staffUserId)
    const membership = await forUser(db, staffUserId).membershipIn(scoped.businessId)
    expect(membership?.role).toBe("staff")
  })
})

describe("agendaAccess", () => {
  it("el dueño ve todo", async () => {
    const access = await agendaAccess({
      role: "owner",
      user: { id: ownerId, email: "duena@example.com", name: null, image: null },
      db: scoped,
    })
    expect(access.all).toBe(true)
    expect(await scoped.bookings.count(bookingsVisibleWhere(access))).toBe(2)
    expect(await scoped.customers.count(customersVisibleWhere(access))).toBe(2)
  })

  it("un profesional ve solo su columna, sus turnos y sus clientes", async () => {
    const access = await agendaAccess({
      role: "staff",
      user: { id: staffUserId, email: "sofi@example.com", name: null, image: null },
      db: scoped,
    })
    expect(access).toEqual({ all: false, resourceIds: [mine.id] })
    expect(canUseResource(access, mine.id)).toBe(true)
    expect(canUseResource(access, theirs.id)).toBe(false)
    expect(canUseResource(access, null)).toBe(false)

    const bookings = await scoped.bookings.findMany({ where: bookingsVisibleWhere(access) })
    expect(bookings.map((b) => b.resourceId)).toEqual([mine.id])

    const customers = await scoped.customers.findMany({ where: customersVisibleWhere(access) })
    expect(customers.map((c) => c.id)).toEqual([myCustomer])
    expect(await canSeeCustomer(scoped, access, myCustomer)).toBe(true)
    expect(await canSeeCustomer(scoped, access, otherCustomer)).toBe(false)
  })

  it("un profesional sin columna no ve nada", async () => {
    const [user] = await db.insert(schema.users).values({ email: "nuevo@example.com" }).returning()
    const access = await agendaAccess({
      role: "staff",
      user: { id: user!.id, email: "nuevo@example.com", name: null, image: null },
      db: scoped,
    })
    expect(access.resourceIds).toEqual([])
    expect(await scoped.bookings.count(bookingsVisibleWhere(access))).toBe(0)
    expect(await scoped.customers.count(customersVisibleWhere(access))).toBe(0)
  })

  it("las condiciones se combinan con otros filtros", async () => {
    const access = await agendaAccess({
      role: "staff",
      user: { id: staffUserId, email: "sofi@example.com", name: null, image: null },
      db: scoped,
    })
    const found = await scoped.customers.findMany({
      where: and(customersVisibleWhere(access), eq(schema.customers.name, "Clienta de la dueña")),
    })
    expect(found).toEqual([])
  })
})
