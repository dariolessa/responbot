import { eq, inArray } from "drizzle-orm"

import { TRIAL_DAYS } from "@/lib/billing/plans"
import { createService, createStaff } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, forUser, type AnyDb, type ScopedDb } from "@/lib/db/scoped"
import { categoryByKey } from "@/lib/onboarding/templates"
import { businessSlug } from "@/lib/slug"

/*
 * Demo pública (docs/SPEC.md, Fase 7: "número de demo pública"). Es un
 * negocio más, marcado con is_demo: tiene todo habilitado sin cobro, el bot
 * avisa que los turnos son de prueba y cada noche se borran sus clientes,
 * turnos y conversaciones (cron demo-reset). El número de WhatsApp se conecta
 * desde el panel como en cualquier negocio (ver docs/PILOTOS.md).
 */

const DAY_MS = 86_400_000

export const DEMO_NAME = "Barbería Demo"

const demoFaq = [
  {
    question: "¿Esto es un negocio de verdad?",
    answer: "No: es la demo de Responbot. Podés reservar, cambiar y cancelar turnos para ver cómo funciona; todo se borra cada noche.",
  },
  {
    question: "¿Cómo lo tengo en mi negocio?",
    answer: "Entrando a la web de Responbot y creando tu cuenta: hay una prueba gratis sin tarjeta.",
  },
  { question: "¿Aceptan tarjeta?", answer: "Sí, efectivo, débito y crédito." },
]

/** Crea la demo con servicios de barbería y dos profesionales; si ya existe una, la devuelve. */
export async function createDemoBusiness(db: AnyDb, userId: string, now: Date = new Date()): Promise<schema.Business> {
  const existing = await forPlatform(db).demoBusinessIds()
  if (existing[0]) {
    const business = await forBusiness(db, existing[0]).business()
    if (business) return business
  }

  const account = forUser(db, userId)
  const previousActive = await account.lastBusinessId()
  const created = await account.createBusiness({
    name: DEMO_NAME,
    slug: businessSlug("demo"),
    archetype: "services",
    timezone: "America/Montevideo",
    currency: "UYU",
    address: "18 de Julio 1234, Montevideo",
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    onboardingCompleted: ["business", "services", "team", "rules", "test_bot"],
  })
  const scoped = forBusiness(db, created.id)
  const business = (await scoped.updateBusiness({ isDemo: true, category: "barberia" }))!

  const services = []
  for (const template of categoryByKey("barberia")?.services ?? []) {
    services.push(
      await createService(scoped, {
        name: template.name,
        description: template.description ?? null,
        durationMinutes: template.durationMinutes,
        price: template.priceUyu,
      }),
    )
  }
  // Lunes a sábado de 10 a 20.
  const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "10:00", endTime: "20:00" }))
  const serviceIds = services.map((s) => s.id)
  await createStaff(scoped, { name: "Martín", serviceIds, hours })
  await createStaff(scoped, { name: "Lucía", serviceIds, hours })

  await scoped.botSettings.update(undefined, {
    assistantName: "Rober",
    welcomeMessage: "¡Hola! Soy Rober, el asistente de la Barbería Demo. Esto es una demo de Responbot: probá pedir un turno.",
    faq: demoFaq,
  })
  // Crear un negocio lo deja como activo; el admin sigue en el que estaba.
  if (previousActive) await account.setActiveBusiness(previousActive)
  return business
}

export type DemoResetResult = { businessId: string; customers: number; bookings: number }

/**
 * Borra lo que generaron los visitantes de la demo: turnos, pagos, lista de
 * espera, mensajes programados, avisos, conversaciones y clientes. Deja el
 * catálogo, el equipo, la configuración y el cliente del chat de prueba.
 */
export async function resetDemoData(scoped: ScopedDb): Promise<DemoResetResult> {
  const business = await scoped.business()
  if (!business?.isDemo) throw new Error("demo: solo se borra un negocio de demo")

  return scoped.transaction(async (tx) => {
    const visitors = await tx.customers.findMany({ where: eq(schema.customers.isTest, false) })
    const visitorIds = visitors.map((c) => c.id)
    await tx.payments.delete()
    const bookings = await tx.bookings.delete()
    await tx.waitlistEntries.delete()
    await tx.scheduledMessages.delete()
    await tx.notifications.delete()
    if (visitorIds.length > 0) {
      // Conversaciones (con sus mensajes y calificaciones) y clientes de los visitantes.
      await tx.conversations.delete(inArray(schema.conversations.customerId, visitorIds))
      await tx.customers.delete(inArray(schema.customers.id, visitorIds))
    }
    return { businessId: business.id, customers: visitorIds.length, bookings: bookings.length }
  })
}

/** Cron nocturno: limpia cada negocio de demo. */
export async function runDemoReset(db: AnyDb): Promise<DemoResetResult[]> {
  const ids = await forPlatform(db).demoBusinessIds()
  const results: DemoResetResult[] = []
  for (const id of ids) results.push(await resetDemoData(forBusiness(db, id)))
  return results
}
