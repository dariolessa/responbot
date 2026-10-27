import { and, eq, gte, inArray, lt, ne } from "drizzle-orm"

import { onboardingIncompleteEmail } from "@/emails/onboarding-incomplete"
import { billingState, hasFeature } from "@/lib/billing/state"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatMoney } from "@/lib/money"
import { pendingSteps } from "@/lib/onboarding/steps"
import { addDaysToDate, dayRange, formatDate, formatZoned, toDateString, toTimeString, weekdayOf } from "@/lib/time"

import { notify, type EmailSender } from "./dispatch"

/*
 * Lo que manda el cron de cada hora según la hora local de cada negocio:
 *
 * - Resumen diario a las 8:00 (WhatsApp al dueño; correo si lo pidió).
 * - Resumen semanal los lunes a las 8:00 (correo, solo a quien lo prendió).
 * - Correos de alta incompleta a las 24 horas y a los 3 días.
 *
 * Cada envío queda anotado en el negocio para no repetirlo si el cron corre
 * dos veces en la misma hora.
 */

export const SUMMARY_HOUR = 8

const activeStatuses = ["pending_payment", "confirmed", "client_confirmed"] as const

function localHour(now: Date, timezone: string): number {
  return Number(formatZoned(now, timezone, "H"))
}

/** Resumen del día: turnos de hoy y reservas que tomó el bot desde ayer. Devuelve si lo procesó. */
export async function sendDailySummary(scoped: ScopedDb, now: Date): Promise<boolean> {
  const business = await scoped.business()
  if (!business) return false
  const tz = business.timezone
  const today = toDateString(now, tz)
  if (business.dailySummarySentOn === today) return false
  // Se anota primero: si algo falla después, no se manda dos veces.
  await scoped.updateBusiness({ dailySummarySentOn: today })

  const { start, end } = dayRange(today, tz)
  const [bookings, botBookings] = await Promise.all([
    scoped.bookings.findMany({
      where: and(
        gte(schema.bookings.startsAt, start),
        lt(schema.bookings.startsAt, end),
        inArray(schema.bookings.status, [...activeStatuses]),
        ne(schema.bookings.source, "test_chat"),
      ),
      orderBy: schema.bookings.startsAt,
    }),
    scoped.bookings.count(
      and(
        eq(schema.bookings.source, "whatsapp"),
        gte(schema.bookings.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    ),
  ])
  // Sin turnos no hay nada que contar: no se gasta una plantilla.
  if (bookings.length === 0) return true

  await notify(scoped, {
    type: "summary.daily",
    payload: {
      date: today,
      bookings: bookings.length,
      firstTime: toTimeString(bookings[0]!.startsAt, tz),
      botBookings,
    },
    now,
  })
  return true
}

/** Resumen de la semana pasada (lunes a domingo), por correo a quien lo pidió. */
export async function sendWeeklySummary(scoped: ScopedDb, now: Date): Promise<boolean> {
  const business = await scoped.business()
  if (!business) return false
  const tz = business.timezone
  const today = toDateString(now, tz)
  if (weekdayOf(today) !== 1 || business.weeklySummarySentOn === today) return false
  // El resumen semanal viene con el plan Equipo (y la prueba).
  if (!hasFeature(billingState(business, now), "weeklySummary")) return false
  await scoped.updateBusiness({ weeklySummarySentOn: today })

  const weekStart = addDaysToDate(today, -7)
  const weekEnd = addDaysToDate(today, -1)
  const from = dayRange(weekStart, tz).start
  const to = dayRange(today, tz).start
  const [bookings, botBookings] = await Promise.all([
    scoped.bookings.findMany({
      where: and(
        gte(schema.bookings.startsAt, from),
        lt(schema.bookings.startsAt, to),
        inArray(schema.bookings.status, [...activeStatuses, "completed", "no_show"]),
        ne(schema.bookings.source, "test_chat"),
      ),
    }),
    scoped.bookings.count(
      and(eq(schema.bookings.source, "whatsapp"), gte(schema.bookings.createdAt, from), lt(schema.bookings.createdAt, to)),
    ),
  ])
  const completed = bookings.filter((b) => b.status === "completed")
  // Ingresos estimados: lo atendido más lo que quedó sin marcar (no cuenta las inasistencias).
  const revenue = bookings.filter((b) => b.status !== "no_show").reduce((sum, b) => sum + b.price, 0)

  await notify(scoped, {
    type: "summary.weekly",
    payload: {
      weekStart: formatDate(weekStart, "d 'de' MMMM"),
      weekEnd: formatDate(weekEnd, "d 'de' MMMM"),
      bookings: bookings.length,
      completed: completed.length,
      noShows: bookings.filter((b) => b.status === "no_show").length,
      revenue: formatMoney(revenue, business.currency),
      botBookings,
    },
    now,
  })
  return true
}

const ONBOARDING_EMAILS = [
  { key: "onboarding_3d", afterMs: 3 * 86_400_000 },
  { key: "onboarding_24h", afterMs: 86_400_000 },
] as const
/** Negocios creados antes de esto no reciben el correo (por ejemplo, los que ya existían al activar la Fase 4). */
const ONBOARDING_EMAIL_WINDOW_MS = 7 * 86_400_000

/** Correo de alta incompleta a los dueños, a las 24 horas y a los 3 días, si faltan pasos. */
export async function sendOnboardingReminder(
  scoped: ScopedDb,
  now: Date,
  email: EmailSender | null,
  appUrl: string,
): Promise<string | null> {
  const business = await scoped.business()
  if (!business || !email) return null
  const age = now.getTime() - business.createdAt.getTime()
  if (age > ONBOARDING_EMAIL_WINDOW_MS) return null
  const due = ONBOARDING_EMAILS.find((e) => age >= e.afterMs && !business.lifecycleEmails.includes(e.key))
  if (!due) return null
  const pending = pendingSteps(business.onboardingCompleted)
  // El de 3 días incluye al de 24 horas: si se manda primero, el otro ya no va.
  const marks = due.key === "onboarding_3d" ? ["onboarding_3d", "onboarding_24h"] : [due.key]
  await scoped.updateBusiness({ lifecycleEmails: [...new Set([...business.lifecycleEmails, ...marks])] })
  if (pending.length === 0) return null

  const owners = (await scoped.members()).filter((m) => m.active && m.role === "owner" && m.email && !m.emailBouncedAt)
  const rendered = await onboardingIncompleteEmail({
    businessName: business.name,
    steps: pending.map((s) => ({ title: s.title, url: `${appUrl}${s.href}` })),
    url: `${appUrl}${pending[0]!.href}`,
    preferencesUrl: `${appUrl}/app/notificaciones`,
  })
  for (const owner of owners) {
    try {
      await email.send({ to: owner.email!, ...rendered })
    } catch (error) {
      console.error("[correos] no se pudo mandar el de alta incompleta", business.id, error)
    }
  }
  return due.key
}

/** Una vuelta del cron horario para un negocio. */
export async function runHourlyForBusiness(
  scoped: ScopedDb,
  timezone: string,
  now: Date,
  email: EmailSender | null,
  appUrl: string,
) {
  const result = { daily: false, weekly: false, onboarding: null as string | null }
  if (localHour(now, timezone) === SUMMARY_HOUR) {
    result.daily = await sendDailySummary(scoped, now)
    result.weekly = await sendWeeklySummary(scoped, now)
  }
  result.onboarding = await sendOnboardingReminder(scoped, now, email, appUrl)
  return result
}
