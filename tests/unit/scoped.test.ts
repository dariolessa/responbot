import { getTableColumns, getTableName, is } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as schema from "@/lib/db/schema"
import { forBusiness, forUser, tenantTables, type ScopedDb } from "@/lib/db/scoped"
import { createTestDb, type TestDb } from "../helpers/db"

/*
 * Aislamiento multi-tenant (docs/SPEC.md, "Seguridad"): cada test intenta leer,
 * modificar o borrar datos de otro negocio a través de lib/db/scoped.ts, y
 * tiene que fallar (no ver nada, no tocar nada).
 */

let db: TestDb
let close: () => Promise<void>

type Seed = {
  businessId: string
  userId: string
  resourceId: string
  serviceId: string
  customerId: string
  bookingId: string
  scoped: ScopedDb
}

let a: Seed
let b: Seed

const at = (iso: string) => new Date(iso)

async function seedBusiness(name: string, email: string): Promise<Seed> {
  const [user] = await db.insert(schema.users).values({ email, name }).returning()
  const business = await forUser(db, user!.id).createBusiness({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    archetype: "services",
    timezone: "America/Montevideo",
    currency: "UYU",
    trialEndsAt: at("2026-12-01T00:00:00Z"),
  })
  const scoped = forBusiness(db, business.id)
  const [resource] = await scoped.resources.insert({ name: `Profesional de ${name}` })
  const [service] = await scoped.services.insert({
    name: "Corte",
    durationMinutes: 30,
    price: 50000,
  })
  const [customer] = await scoped.customers.insert({ phoneE164: "+59899000000", name: "Ana" })
  await scoped.resourceServices.insert({ resourceId: resource!.id, serviceId: service!.id })
  await scoped.workingHours.insert({
    resourceId: resource!.id,
    weekday: 1,
    startTime: "09:00",
    endTime: "13:00",
  })
  await scoped.timeOff.insert({
    startsAt: at("2026-12-25T00:00:00Z"),
    endsAt: at("2026-12-26T00:00:00Z"),
    reason: "Navidad",
  })
  const [booking] = await scoped.bookings.insert({
    customerId: customer!.id,
    resourceId: resource!.id,
    serviceId: service!.id,
    startsAt: at("2026-11-02T13:00:00Z"),
    endsAt: at("2026-11-02T13:30:00Z"),
    price: 50000,
    currency: "UYU",
    source: "panel",
  })
  await scoped.bookingEvents.insert({
    bookingId: booking!.id,
    toStatus: "confirmed",
    actorType: "user",
    actorId: user!.id,
    channel: "panel",
  })
  const [conversation] = await scoped.conversations.insert({ customerId: customer!.id })
  await scoped.messages.insert({
    conversationId: conversation!.id,
    direction: "inbound",
    body: "Hola",
    status: "received",
  })
  await scoped.auditLogs.insert({ actorId: user!.id, action: "business.created" })

  return {
    businessId: business.id,
    userId: user!.id,
    resourceId: resource!.id,
    serviceId: service!.id,
    customerId: customer!.id,
    bookingId: booking!.id,
    scoped,
  }
}

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  a = await seedBusiness("Barbería Centro", "dueno-a@example.com")
  b = await seedBusiness("Uñas Pocitos", "duena-b@example.com")
})

afterAll(async () => {
  await close()
})

describe("forBusiness: lecturas", () => {
  it("cada tabla de negocio devuelve solo filas del negocio del scope", async () => {
    for (const [key, table] of Object.entries(tenantTables)) {
      const repo = a.scoped[key as keyof typeof tenantTables]
      const rows = (await repo.findMany()) as { businessId: string }[]
      for (const row of rows) {
        expect(row.businessId, `${key} filtró una fila de otro negocio`).toBe(a.businessId)
      }
      // Y el otro negocio tiene sus propias filas, que A no ve.
      const total = await db.$count(table)
      const own = await repo.count()
      const others = await b.scoped[key as keyof typeof tenantTables].count()
      expect(own + others, key).toBe(total)
    }
  })

  it("no encuentra por id un registro de otro negocio", async () => {
    expect(await a.scoped.bookings.findById(b.bookingId)).toBeUndefined()
    expect(await a.scoped.customers.findById(b.customerId)).toBeUndefined()
    expect(await a.scoped.services.findById(b.serviceId)).toBeUndefined()
    expect(await a.scoped.bookings.findById(a.bookingId)).toBeDefined()
  })

  it("un filtro explícito por el id de otro negocio no devuelve nada", async () => {
    const rows = await a.scoped.customers.findMany({
      where: eq(schema.customers.businessId, b.businessId),
    })
    expect(rows).toEqual([])
  })

  it("business() devuelve solo el negocio del scope", async () => {
    expect((await a.scoped.business())?.id).toBe(a.businessId)
  })
})

describe("forBusiness: escrituras", () => {
  it("insert ignora un business_id ajeno y usa el del scope", async () => {
    const [created] = await a.scoped.customers.insert({
      phoneE164: "+59899111111",
      // Intento deliberado de colar otro negocio.
      ...({ businessId: b.businessId } as object),
    })
    expect(created!.businessId).toBe(a.businessId)
    expect(await b.scoped.customers.findById(created!.id)).toBeUndefined()
  })

  it("update no toca filas de otro negocio", async () => {
    const updated = await a.scoped.customers.update(eq(schema.customers.id, b.customerId), {
      name: "Hackeado",
    })
    expect(updated).toEqual([])
    expect((await b.scoped.customers.findById(b.customerId))?.name).toBe("Ana")
  })

  it("update sin filtro solo afecta al propio negocio", async () => {
    await a.scoped.customers.update(undefined, { notes: "nota de A" })
    const others = await b.scoped.customers.findMany()
    expect(others.every((c) => c.notes === null)).toBe(true)
  })

  it("update no puede mover una fila a otro negocio", async () => {
    const [moved] = await a.scoped.services.update(eq(schema.services.id, a.serviceId), {
      name: "Corte y barba",
      ...({ businessId: b.businessId } as object),
    })
    expect(moved!.businessId).toBe(a.businessId)
    expect(moved!.name).toBe("Corte y barba")
  })

  it("delete no borra filas de otro negocio", async () => {
    const deleted = await a.scoped.timeOff.delete()
    expect(deleted.length).toBeGreaterThan(0)
    expect(deleted.every((row) => row.businessId === a.businessId)).toBe(true)
    expect(await b.scoped.timeOff.count()).toBe(1)

    const none = await a.scoped.bookingEvents.delete(eq(schema.bookingEvents.businessId, b.businessId))
    expect(none).toEqual([])
  })

  it("updateBusiness solo cambia el negocio del scope", async () => {
    await a.scoped.updateBusiness({ address: "18 de Julio 1234" })
    expect((await b.scoped.business())?.address).toBeNull()
  })

  it("las transacciones mantienen el mismo negocio", async () => {
    const seen = await a.scoped.transaction(async (tx) => {
      expect(tx.businessId).toBe(a.businessId)
      return tx.customers.findMany()
    })
    expect(seen.every((c) => c.businessId === a.businessId)).toBe(true)
  })

  it("no se puede crear un scope sin business_id", () => {
    expect(() => forBusiness(db, "")).toThrow(/business_id/)
  })
})

describe("cobertura del scope", () => {
  it("toda tabla con business_id está en tenantTables", () => {
    const covered = new Set(Object.values(tenantTables).map((t) => getTableName(t)))
    const withBusinessId = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => is(value, PgTable))
      .filter((table) => "businessId" in getTableColumns(table))
      .map((table) => getTableName(table))
    expect(withBusinessId.length).toBeGreaterThan(0)
    for (const name of withBusinessId) expect(covered, name).toContain(name)
  })
})

describe("forUser", () => {
  it("lista solo las membresías propias", async () => {
    const list = await forUser(db, a.userId).listMemberships()
    expect(list.map((m) => m.businessId)).toEqual([a.businessId])
    expect(list[0]!.role).toBe("owner")
  })

  it("no deja activar un negocio del que no es miembro", async () => {
    const userA = forUser(db, a.userId)
    expect(await userA.setActiveBusiness(b.businessId)).toBe(false)
    expect(await userA.lastBusinessId()).toBe(a.businessId)
  })

  it("una membresía desactivada pierde el acceso", async () => {
    const [staff] = await db.insert(schema.users).values({ email: "ex@example.com" }).returning()
    await a.scoped.memberships.insert({ userId: staff!.id, role: "staff", active: false })
    expect(await forUser(db, staff!.id).membershipIn(a.businessId)).toBeUndefined()
    expect(await forUser(db, staff!.id).listMemberships()).toEqual([])
  })

  it("acepta invitaciones vigentes para su email e ignora las vencidas", async () => {
    await b.scoped.invitations.insert([
      {
        email: "Profe@Example.com",
        role: "staff",
        tokenHash: "hash-vigente",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ])
    await a.scoped.invitations.insert({
      email: "profe@example.com",
      role: "admin",
      tokenHash: "hash-vencida",
      expiresAt: new Date(Date.now() - 1000),
    })
    const [profe] = await db.insert(schema.users).values({ email: "profe@example.com" }).returning()
    const scope = forUser(db, profe!.id)

    expect(await scope.acceptPendingInvitations("profe@example.com")).toEqual([b.businessId])
    const memberships = await scope.listMemberships()
    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({ businessId: b.businessId, role: "staff" })
    expect(await scope.lastBusinessId()).toBe(b.businessId)

    // Una segunda vez no hace nada: la invitación ya fue aceptada.
    expect(await scope.acceptPendingInvitations("profe@example.com")).toEqual([])
  })
})

describe("restricción de exclusión de turnos", () => {
  const base = () => ({
    customerId: a.customerId,
    resourceId: a.resourceId,
    serviceId: a.serviceId,
    price: 50000,
    currency: "UYU",
    source: "panel" as const,
  })

  it("rechaza un turno superpuesto en el mismo recurso", async () => {
    await expect(
      a.scoped.bookings.insert({
        ...base(),
        startsAt: at("2026-11-02T13:15:00Z"),
        endsAt: at("2026-11-02T13:45:00Z"),
      }),
    ).rejects.toThrow()
  })

  it("permite turnos contiguos y turnos sobre un horario cancelado", async () => {
    await a.scoped.bookings.insert({
      ...base(),
      startsAt: at("2026-11-02T13:30:00Z"),
      endsAt: at("2026-11-02T14:00:00Z"),
    })
    await a.scoped.bookings.update(eq(schema.bookings.id, a.bookingId), { status: "cancelled" })
    const [replacement] = await a.scoped.bookings.insert({
      ...base(),
      startsAt: at("2026-11-02T13:00:00Z"),
      endsAt: at("2026-11-02T13:30:00Z"),
    })
    expect(replacement!.status).toBe("confirmed")
  })
})
