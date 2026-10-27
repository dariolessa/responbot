import { eq } from "drizzle-orm"

import { notificationEmail } from "@/emails/notification"
import { queueReactivations } from "@/lib/booking/follow-ups"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { notify, type EmailSender } from "@/lib/notifications/dispatch"
import { formatZoned } from "@/lib/time"

import { monthUsage, usagePercent } from "./access"
import { plans, USAGE_ALERT_THRESHOLDS } from "./plans"
import { billingState } from "./state"

/*
 * Lo que hace el cron de cada hora con la facturación y los mensajes
 * automáticos de cada negocio, según su hora local:
 *
 * - 8:00: correo de fin de prueba (3 días antes y el último día).
 * - 10:00: encola las reactivaciones de clientes.
 * - Siempre: avisos de uso del plan al 80 % y al 100 % (una vez por mes y
 *   límite, anotados en usage_counters.alerts_sent).
 */

export const TRIAL_EMAIL_HOUR = 8
export const REACTIVATION_HOUR = 10

function localHour(now: Date, timezone: string): number {
  return Number(formatZoned(now, timezone, "H"))
}

/** Correo de fin de prueba al dueño. Devuelve la marca que mandó, o null. */
export async function sendTrialEndingEmail(
  scoped: ScopedDb,
  now: Date,
  email: EmailSender | null,
  appUrl: string,
): Promise<string | null> {
  const business = await scoped.business()
  if (!business || !email) return null
  const state = billingState(business, now)
  if (state.status !== "trialing" || state.trialDaysLeft === null || state.trialDaysLeft > 3) return null
  const key = state.trialDaysLeft === 0 ? "trial_end" : "trial_3d"
  if (business.lifecycleEmails.includes(key)) return null
  // El del último día incluye al de 3 días: si se manda primero, el otro ya no va.
  const marks = key === "trial_end" ? ["trial_end", "trial_3d"] : [key]
  await scoped.updateBusiness({ lifecycleEmails: [...new Set([...business.lifecycleEmails, ...marks])] })

  const suggested = (await scoped.resources.count(eq(schema.resources.active, true))) > 1 ? plans.pro : plans.basic
  const rendered = await notificationEmail(
    key === "trial_end" ? `Tu prueba termina hoy · ${business.name}` : `Tu prueba termina en 3 días · ${business.name}`,
    {
      businessName: business.name,
      title: key === "trial_end" ? "Tu prueba termina hoy" : "Te quedan 3 días de prueba",
      body:
        key === "trial_end"
          ? `Desde mañana el bot sigue respondiendo consultas pero deja de reservar turnos. Para seguir, elegí un plan; para tu negocio te sugerimos el ${suggested.name}.`
          : `Para que el bot siga reservando turnos cuando termine la prueba, elegí un plan. Para tu negocio te sugerimos el ${suggested.name}; se empieza a cobrar recién cuando termina la prueba.`,
      button: { label: "Elegir plan", url: `${appUrl}/app/facturacion` },
      preferencesUrl: `${appUrl}/app/notificaciones`,
    },
  )
  const owners = (await scoped.members()).filter((m) => m.active && m.role === "owner" && m.email && !m.emailBouncedAt)
  for (const owner of owners) {
    try {
      await email.send({ to: owner.email!, ...rendered })
    } catch (error) {
      console.error("[correos] no se pudo mandar el de fin de prueba", business.id, error)
    }
  }
  return key
}

/** Avisos de uso del mes al dueño. Devuelve las marcas nuevas. */
export async function checkUsageAlerts(scoped: ScopedDb, now: Date): Promise<string[]> {
  const business = await scoped.business()
  if (!business) return []
  const state = billingState(business, now)
  // Sin poder reservar ya hay un aviso más importante en el panel.
  if (!state.canBook) return []
  const usage = await monthUsage(scoped, state, business.timezone, now)
  const counter = await scoped.usageCounters.findFirst(eq(schema.usageCounters.period, usage.period))
  if (!counter) return []

  const fresh: string[] = []
  for (const metric of ["conversations", "templates"] as const) {
    const { used, limit } = usage[metric]
    const percent = usagePercent(used, limit)
    // Solo el umbral más alto alcanzado: si se pasa de 70 a 100 de golpe, llega un aviso.
    const reached = [...USAGE_ALERT_THRESHOLDS].reverse().find((t) => percent >= t)
    if (!reached) continue
    const key = `${metric}_${reached}`
    if (counter.alertsSent.includes(key)) continue
    const lower = USAGE_ALERT_THRESHOLDS.filter((t) => t <= reached).map((t) => `${metric}_${t}`)
    fresh.push(...lower.filter((k) => !counter.alertsSent.includes(k)))
    await notify(scoped, {
      type: "billing.usage",
      payload: { metric, percent: reached, used, limit, planName: state.plan.name },
      now,
    })
  }
  if (fresh.length) {
    await scoped.usageCounters.update(eq(schema.usageCounters.id, counter.id), {
      alertsSent: [...new Set([...counter.alertsSent, ...fresh])],
    })
  }
  return fresh
}

/** Una vuelta del cron horario para un negocio. Devuelve si dejó avisos para mandar. */
export async function runBillingHourly(
  scoped: ScopedDb,
  timezone: string,
  now: Date,
  email: EmailSender | null,
  appUrl: string,
) {
  const hour = localHour(now, timezone)
  const result = {
    trialEmail: hour === TRIAL_EMAIL_HOUR ? await sendTrialEndingEmail(scoped, now, email, appUrl) : null,
    usageAlerts: await checkUsageAlerts(scoped, now),
    reactivations: hour === REACTIVATION_HOUR ? await queueReactivations(scoped, now) : 0,
  }
  return { ...result, pending: result.usageAlerts.length > 0 || result.reactivations > 0 }
}
