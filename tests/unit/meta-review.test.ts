import { createHmac } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { createPasswordSession } from "@/lib/auth/password-login"
import { billingState } from "@/lib/billing/state"
import * as schema from "@/lib/db/schema"
import { forBusiness, forUser } from "@/lib/db/scoped"
import { parseSignedRequest } from "@/lib/integrations/whatsapp/signed-request"
import { dataDeletionStatus, handleDataDeletionRequest } from "@/lib/meta-data-deletion"
import { REVIEWER_BUSINESS_NAME, REVIEWER_EMAIL, seedMetaReviewer } from "@/lib/pilots/reviewer"
import { createTestDb, type TestDb } from "../helpers/db"

/*
 * Preparación para el App Review de Meta: contraseña de la cuenta de prueba,
 * seed de reviewer@responbot.com y callback de eliminación de datos.
 */

const NOW = new Date("2026-11-08T12:00:00Z")
const PASSWORD = "una-clave-de-prueba-larga"

let db: TestDb
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

describe("contraseñas", () => {
  it("verifica la correcta y rechaza las demás", async () => {
    const hash = await hashPassword(PASSWORD)
    expect(hash.startsWith("scrypt$")).toBe(true)
    expect(hash).not.toContain(PASSWORD)
    expect(await verifyPassword(PASSWORD, hash)).toBe(true)
    expect(await verifyPassword("otra", hash)).toBe(false)
    expect(await verifyPassword(PASSWORD, null)).toBe(false)
    expect(await verifyPassword(PASSWORD, "basura")).toBe(false)
  })
})

describe("cuenta de los revisores de Meta", () => {
  it("rechaza contraseñas cortas", async () => {
    await expect(seedMetaReviewer(db, { password: "corta", now: NOW })).rejects.toThrow(/12 caracteres/)
  })

  it("crea usuario, negocio con todo habilitado, servicios, horarios, turnos y conversaciones", async () => {
    const result = await seedMetaReviewer(db, { password: PASSWORD, now: NOW })
    expect(result.createdUser).toBe(true)
    expect(result.createdBusiness).toBe(true)
    expect(result.bookingsCreated).toBe(3)
    expect(result.conversationsCreated).toBe(3)

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, REVIEWER_EMAIL))
    expect(user?.emailVerified).not.toBeNull()
    expect(user?.lastBusinessId).toBe(result.businessId)

    const memberships = await forUser(db, result.userId).listMemberships()
    expect(memberships).toEqual([expect.objectContaining({ businessName: REVIEWER_BUSINESS_NAME, role: "owner" })])

    const scoped = forBusiness(db, result.businessId)
    const business = (await scoped.business())!
    // Sin pagar, sin prueba que venza: piloto con todo habilitado.
    const inAYear = billingState(business, new Date(NOW.getTime() + 365 * 86_400_000))
    expect(inAYear.status).toBe("pilot")
    expect(inAYear.readOnly).toBe(false)
    expect(inAYear.canBook).toBe(true)
    expect(Object.values(inAYear.plan.features).every(Boolean)).toBe(true)

    const services = await scoped.services.findMany()
    expect(services.length).toBeGreaterThan(3)
    expect(services.every((s) => s.price > 0 && s.durationMinutes > 0)).toBe(true)
    expect(await scoped.resources.count()).toBe(2)
    expect(await scoped.workingHours.count()).toBe(12)
    const bookings = await scoped.bookings.findMany()
    expect(bookings.every((b) => b.startsAt > NOW && b.startsAt < new Date(NOW.getTime() + 14 * 86_400_000))).toBe(true)
    // Los turnos de ejemplo no programan recordatorios a números ficticios.
    expect(await scoped.scheduledMessages.count()).toBe(0)
    expect(await scoped.conversations.count()).toBe(3)
    expect(await scoped.messages.count()).toBeGreaterThanOrEqual(9)
    expect(await scoped.whatsappAccounts.count()).toBe(0)
  })

  it("es idempotente y cambia la contraseña", async () => {
    const again = await seedMetaReviewer(db, { password: `${PASSWORD}-nueva`, now: NOW })
    expect(again.createdUser).toBe(false)
    expect(again.createdBusiness).toBe(false)
    expect(again.bookingsCreated).toBe(0)
    expect(again.conversationsCreated).toBe(0)
    const scoped = forBusiness(db, again.businessId)
    expect(await scoped.conversations.count()).toBe(3)
    expect(await scoped.bookings.count()).toBe(3)

    expect(await createPasswordSession(db, REVIEWER_EMAIL, PASSWORD, NOW)).toBeNull()
    const session = await createPasswordSession(db, "Reviewer@Responbot.com ", `${PASSWORD}-nueva`, NOW)
    expect(session?.sessionToken).toMatch(/^[0-9a-f]{64}$/)
    const [row] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.sessionToken, session!.sessionToken))
    expect(row?.userId).toBe(again.userId)
  })

  it("vuelve a poner turnos cuando los de ejemplo ya pasaron", async () => {
    const later = new Date(NOW.getTime() + 20 * 86_400_000)
    const result = await seedMetaReviewer(db, { password: PASSWORD, now: later })
    expect(result.bookingsCreated).toBe(3)
  })

  it("no deja entrar con contraseña a quien no tiene una", async () => {
    await db.insert(schema.users).values({ email: "google@example.com" })
    expect(await createPasswordSession(db, "google@example.com", PASSWORD, NOW)).toBeNull()
    expect(await createPasswordSession(db, "nadie@example.com", PASSWORD, NOW)).toBeNull()
  })
})

function signedRequest(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", secret).update(body).digest("base64url")
  return `${signature}.${body}`
}

describe("eliminación de datos de Meta", () => {
  it("valida la firma del signed_request", () => {
    const signed = signedRequest({ algorithm: "HMAC-SHA256", user_id: "1234567890", issued_at: 1 }, "secreto")
    expect(parseSignedRequest(signed, "secreto")?.user_id).toBe("1234567890")
    expect(parseSignedRequest(signed, "otro")).toBeNull()
    expect(parseSignedRequest("basura", "secreto")).toBeNull()
  })

  it("borra la conexión de WhatsApp y sus conversaciones, y deja el código consultable", async () => {
    const { businessId } = await seedMetaReviewer(db, { password: PASSWORD, now: NOW })
    const scoped = forBusiness(db, businessId)
    await scoped.whatsappAccounts.insert({
      wabaId: "111",
      phoneNumberId: "222",
      displayPhone: "+598 99 000 000",
      accessTokenEnc: "cifrado",
      metaUserId: "555000",
    })
    await scoped.updateBusiness({ onboardingCompleted: ["business", "whatsapp"] })
    const unsubscribed: string[] = []

    const outcome = await handleDataDeletionRequest(db, "555000", {
      now: NOW,
      unsubscribe: async (account) => void unsubscribed.push(account.wabaId),
    })
    expect(outcome.status).toBe("completed")
    expect(outcome.code).toMatch(/^[A-Z2-9]{12}$/)
    expect(unsubscribed).toEqual(["111"])
    expect(await scoped.whatsappAccounts.count()).toBe(0)
    expect(await scoped.conversations.count()).toBe(0)
    // La agenda del negocio queda.
    expect(await scoped.bookings.count()).toBeGreaterThan(0)
    expect((await scoped.business())!.onboardingCompleted).toEqual(["business"])

    const status = await dataDeletionStatus(db, outcome.code)
    expect(status).toMatchObject({ status: "completed", result: { whatsappAccounts: 1, conversations: 3 } })
    expect(await dataDeletionStatus(db, "NOEXISTE1234")).toBeUndefined()
    expect(await dataDeletionStatus(db, "x'; drop")).toBeNull()
  })

  it("registra el pedido aunque no haya datos de esa persona", async () => {
    const outcome = await handleDataDeletionRequest(db, "999", { now: NOW })
    const status = await dataDeletionStatus(db, outcome.code)
    expect(status).toMatchObject({ status: "completed", result: { whatsappAccounts: 0, conversations: 0 } })
  })
})
