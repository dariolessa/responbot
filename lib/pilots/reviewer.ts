import { and, eq, gt, inArray } from "drizzle-orm"

import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password"
import { createService, createStaff } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { forBusiness, forUser, type AnyDb, type ScopedDb } from "@/lib/db/scoped"
import { categoryByKey } from "@/lib/onboarding/templates"
import { businessSlug } from "@/lib/slug"

/*
 * Cuenta de prueba para el App Review de Meta (whatsapp_business_messaging y
 * whatsapp_business_management). La crea scripts/seed-meta-reviewer.ts:
 *
 * - Usuario reviewer@responbot.com con contraseña (la del entorno
 *   META_REVIEWER_PASSWORD, guardada con hash), que entra en /login con
 *   "Entrar con email y contraseña".
 * - Negocio "Peluquería Demo" con servicios, dos profesionales con horario,
 *   unos turnos tomados (el resto de los próximos 14 días queda libre) y tres
 *   conversaciones de ejemplo en la bandeja.
 * - Todo habilitado sin pagar: el negocio queda como piloto por 10 años
 *   (billingState lo trata como plan Equipo sin cobro, sin prueba que venza
 *   y sin pedir tarjeta).
 *
 * Es idempotente: correrlo de nuevo actualiza la contraseña, renueva el
 * piloto y vuelve a poner turnos futuros si ya pasaron, sin duplicar nada.
 * No conecta WhatsApp: eso lo hacen los revisores con "Conectar WhatsApp".
 */

export const REVIEWER_EMAIL = "reviewer@responbot.com"
export const REVIEWER_NAME = "Meta App Review"
export const REVIEWER_BUSINESS_NAME = "Peluquería Demo"

const DAY_MS = 86_400_000
const PILOT_YEARS = 10

const faq = [
  { question: "¿Dónde quedan?", answer: "En 18 de Julio 1234, Montevideo, a media cuadra de la plaza." },
  { question: "¿Qué medios de pago aceptan?", answer: "Efectivo, débito y crédito." },
  {
    question: "¿Puedo cancelar un turno?",
    answer: "Sí, avisando con al menos 3 horas de anticipación, por acá mismo.",
  },
]

/** Clientes y conversaciones de ejemplo (números ficticios, no se les manda nada). */
const sampleChats: {
  phone: string
  name: string
  messages: { direction: "inbound" | "outbound"; body: string; minutesAgo: number; byOwner?: boolean }[]
  mode?: "bot" | "human"
}[] = [
  {
    phone: "+59899000101",
    name: "Valentina Pérez",
    messages: [
      { direction: "inbound", body: "Hola! ¿Tienen turno para corte de dama esta semana?", minutesAgo: 190 },
      {
        direction: "outbound",
        body: "¡Hola Valentina! Sí 😊 El corte de dama sale $ 900 y dura 45 minutos. Tengo lugar el jueves a las 10:00, 11:30 o 15:00. ¿Cuál te queda mejor?",
        minutesAgo: 189,
      },
      { direction: "inbound", body: "El jueves a las 11:30", minutesAgo: 185 },
      {
        direction: "outbound",
        body: "¡Listo! Te reservé corte de dama el jueves a las 11:30 con Carla. Te mando un recordatorio el día anterior.",
        minutesAgo: 184,
      },
    ],
  },
  {
    phone: "+59899000102",
    name: "Martín Rodríguez",
    messages: [
      { direction: "inbound", body: "Buenas, ¿cuánto sale el color de raíz?", minutesAgo: 95 },
      {
        direction: "outbound",
        body: "¡Hola Martín! El color de raíz sale $ 1.800 y lleva una hora y media. ¿Querés que te busque un turno?",
        minutesAgo: 94,
      },
      { direction: "inbound", body: "Sí, ¿tenés algo el sábado de mañana?", minutesAgo: 60 },
      {
        direction: "outbound",
        body: "El sábado tengo a las 9:00 o a las 10:30 con Sofía. ¿Te reservo alguno?",
        minutesAgo: 59,
      },
    ],
  },
  {
    phone: "+59899000103",
    name: "Lucía Fernández",
    mode: "human",
    messages: [
      { direction: "inbound", body: "Hola, quería saber si hacen peinados para casamiento a domicilio", minutesAgo: 30 },
      {
        direction: "outbound",
        body: "¡Hola Lucía! Eso lo coordina directamente la peluquería: ya le avisé a la dueña y te escribe en un ratito.",
        minutesAgo: 29,
      },
      {
        direction: "outbound",
        body: "Hola Lucía, soy Ana de Peluquería Demo. Sí, vamos a domicilio. ¿Qué fecha es el casamiento?",
        minutesAgo: 20,
        byOwner: true,
      },
    ],
  },
]

export type ReviewerSeedResult = {
  userId: string
  businessId: string
  createdUser: boolean
  createdBusiness: boolean
  bookingsCreated: number
  conversationsCreated: number
}

export async function seedMetaReviewer(
  db: AnyDb,
  options: { password: string; email?: string; now?: Date },
): Promise<ReviewerSeedResult> {
  const now = options.now ?? new Date()
  const email = (options.email ?? REVIEWER_EMAIL).trim().toLowerCase()
  if (options.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }
  const passwordHash = await hashPassword(options.password)

  // 1. Usuario (email verificado: no hace falta abrir ningún correo).
  const [existingUser] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
  const user = existingUser
    ? (await db
        .update(schema.users)
        .set({ passwordHash, emailVerified: existingUser.emailVerified ?? now, name: existingUser.name ?? REVIEWER_NAME })
        .where(eq(schema.users.id, existingUser.id))
        .returning())[0]!
    : (await db
        .insert(schema.users)
        .values({ email, name: REVIEWER_NAME, emailVerified: now, passwordHash })
        .returning())[0]!

  // 2. Negocio demo (uno solo por usuario, encontrado por nombre).
  const account = forUser(db, user.id)
  const memberships = await account.listMemberships()
  let businessId = memberships.find((m) => m.businessName === REVIEWER_BUSINESS_NAME && m.role === "owner")?.businessId
  const createdBusiness = !businessId
  if (!businessId) businessId = (await createReviewerBusiness(db, user.id, now)).id
  await account.setActiveBusiness(businessId)

  const scoped = forBusiness(db, businessId)
  const pilotEndsAt = new Date(now.getTime() + PILOT_YEARS * 365 * DAY_MS)
  await scoped.updateBusiness({ pilotEndsAt, trialEndsAt: pilotEndsAt })

  // 3. Datos de ejemplo: conversaciones y turnos futuros.
  const customers = await upsertSampleCustomers(scoped)
  const conversationsCreated = await ensureSampleConversations(scoped, customers, user.id, now)
  const bookingsCreated = await ensureFutureBookings(scoped, customers, now)

  return { userId: user.id, businessId, createdUser: !existingUser, createdBusiness, bookingsCreated, conversationsCreated }
}

async function createReviewerBusiness(db: AnyDb, userId: string, now: Date): Promise<schema.Business> {
  const created = await forUser(db, userId).createBusiness({
    name: REVIEWER_BUSINESS_NAME,
    slug: businessSlug("peluqueria-demo"),
    archetype: "services",
    timezone: "America/Montevideo",
    currency: "UYU",
    address: "18 de Julio 1234, Montevideo",
    trialEndsAt: new Date(now.getTime() + PILOT_YEARS * 365 * DAY_MS),
    // Todo el alta hecho menos WhatsApp, que es lo que prueban los revisores.
    onboardingCompleted: ["business", "services", "team", "rules", "test_bot"],
  })
  const scoped = forBusiness(db, created.id)
  await scoped.updateBusiness({ category: "peluqueria" })

  const services: schema.Service[] = []
  for (const template of categoryByKey("peluqueria")?.services ?? []) {
    services.push(
      await createService(scoped, {
        name: template.name,
        description: template.description ?? null,
        durationMinutes: template.durationMinutes,
        price: template.priceUyu,
      }),
    )
  }
  // Lunes a viernes de 9 a 19 y sábados de 9 a 14.
  const hours = [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "19:00" })),
    { weekday: 6, startTime: "09:00", endTime: "14:00" },
  ]
  const serviceIds = services.map((s) => s.id)
  await createStaff(scoped, { name: "Carla", serviceIds, hours })
  await createStaff(scoped, { name: "Sofía", serviceIds, hours })

  await scoped.botSettings.update(undefined, {
    assistantName: "Sole",
    welcomeMessage: "¡Hola! Soy Sole, la asistente de Peluquería Demo. Te paso precios y te reservo turno al toque.",
    faq,
  })
  return (await scoped.business())!
}

async function upsertSampleCustomers(scoped: ScopedDb): Promise<schema.Customer[]> {
  const result: schema.Customer[] = []
  for (const chat of sampleChats) {
    const existing = await scoped.customers.findFirst(eq(schema.customers.phoneE164, chat.phone))
    result.push(existing ?? (await scoped.customers.insert({ phoneE164: chat.phone, name: chat.name }))[0]!)
  }
  return result
}

async function ensureSampleConversations(
  scoped: ScopedDb,
  customers: schema.Customer[],
  ownerId: string,
  now: Date,
): Promise<number> {
  let created = 0
  for (const [index, chat] of sampleChats.entries()) {
    const customer = customers[index]!
    if (await scoped.conversations.findFirst(eq(schema.conversations.customerId, customer.id))) continue
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000)
    const last = chat.messages[chat.messages.length - 1]!
    const lastInbound = [...chat.messages].reverse().find((m) => m.direction === "inbound")
    const [conversation] = await scoped.conversations.insert({
      customerId: customer.id,
      mode: chat.mode ?? "bot",
      assignedTo: chat.mode === "human" ? ownerId : null,
      lastInboundAt: lastInbound ? at(lastInbound.minutesAgo) : null,
      lastMessageAt: at(last.minutesAgo),
      lastMessagePreview: last.body.slice(0, 120),
      unreadCount: last.direction === "inbound" ? 1 : 0,
    })
    await scoped.messages.insert(
      chat.messages.map((m) => ({
        conversationId: conversation!.id,
        direction: m.direction,
        type: "text" as const,
        body: m.body,
        status: m.direction === "inbound" ? ("received" as const) : ("read" as const),
        sentBy: m.byOwner ? ownerId : null,
        createdAt: at(m.minutesAgo),
      })),
    )
    created++
  }
  return created
}

/**
 * Tres turnos en los próximos días (sin recordatorios: los clientes son
 * ficticios). Si ya hay turnos futuros de estos clientes, no agrega más.
 */
async function ensureFutureBookings(scoped: ScopedDb, customers: schema.Customer[], now: Date): Promise<number> {
  const customerIds = customers.map((c) => c.id)
  const future = await scoped.bookings.count(
    and(inArray(schema.bookings.customerId, customerIds), gt(schema.bookings.startsAt, now)),
  )
  if (future > 0) return 0

  const [business, staff, services] = await Promise.all([
    scoped.business(),
    scoped.resources.findMany({ where: eq(schema.resources.active, true), orderBy: schema.resources.createdAt }),
    scoped.services.findMany({ where: eq(schema.services.active, true), orderBy: schema.services.createdAt }),
  ])
  if (!business || staff.length === 0 || services.length === 0) return 0

  // Días hábiles a partir de pasado mañana, a las 10, 11 y 15 h de Montevideo (UTC-3).
  const plan = [
    { dayOffset: 2, hourUtc: 13, customer: 0, staff: 0, service: 0 },
    { dayOffset: 3, hourUtc: 14, customer: 1, staff: 1, service: 4 },
    { dayOffset: 5, hourUtc: 18, customer: 2, staff: 0, service: 7 },
  ]
  let created = 0
  for (const item of plan) {
    const day = nextWeekday(new Date(now.getTime() + item.dayOffset * DAY_MS))
    const startsAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), item.hourUtc))
    const service = services[item.service] ?? services[0]!
    const resource = staff[item.staff] ?? staff[0]!
    const [booking] = await scoped.bookings.insert({
      customerId: customers[item.customer]!.id,
      resourceId: resource.id,
      serviceId: service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000),
      status: "confirmed",
      price: service.price,
      currency: business.currency,
      source: "whatsapp",
    })
    await scoped.bookingEvents.insert({
      bookingId: booking!.id,
      fromStatus: null,
      toStatus: "confirmed",
      actorType: "bot",
      actorId: null,
      channel: "whatsapp",
    })
    created++
  }
  return created
}

/** El mismo día si es de lunes a viernes; si cae sábado o domingo, el lunes siguiente. */
function nextWeekday(date: Date): Date {
  const weekday = date.getUTCDay()
  if (weekday === 6) return new Date(date.getTime() + 2 * DAY_MS)
  if (weekday === 0) return new Date(date.getTime() + DAY_MS)
  return date
}
