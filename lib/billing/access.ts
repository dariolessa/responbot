import { eq } from "drizzle-orm"

import { usagePeriod } from "@/lib/bot/usage"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { fail, type ActionFailure } from "@/lib/forms"

import { cheapestPlanForStaff, cheapestPlanWith, featureLabels, type Feature } from "./plans"
import { billingState, hasFeature, readOnlyMessage, type BillingState } from "./state"

/*
 * Lo que preguntan las acciones, el bot y los crons sobre el plan del negocio,
 * con su scope. Las reglas en sí viven en plans.ts y state.ts.
 */

export async function businessBilling(scoped: ScopedDb, now: Date = new Date()): Promise<BillingState> {
  const business = await scoped.business()
  if (!business) throw new Error("billing: no existe el negocio")
  return billingState(business, now)
}

/** Si el panel está en solo lectura, el error para devolver desde la acción. */
export async function readOnlyFailure(scoped: ScopedDb, now: Date = new Date()): Promise<ActionFailure | null> {
  const state = await businessBilling(scoped, now)
  return state.readOnly ? fail(readOnlyMessage(state)) : null
}

/** Error para una función que el plan no incluye. */
export function featureFailure(feature: Feature): ActionFailure {
  const plan = cheapestPlanWith(feature)
  return fail(`${featureLabels[feature]} viene con el plan ${plan.name}. Podés cambiarlo en Facturación.`)
}

export async function hasPlanFeature(scoped: ScopedDb, feature: Feature, now: Date = new Date()): Promise<boolean> {
  return hasFeature(await businessBilling(scoped, now), feature)
}

/** Profesionales activos de la agenda (lo que cuenta para el límite del plan). */
export function activeStaffCount(scoped: ScopedDb): Promise<number> {
  return scoped.resources.count(eq(schema.resources.active, true))
}

/** Error si el plan no deja tener `count` profesionales activos; null si entra. */
export function staffLimitFailure(state: BillingState, count: number): ActionFailure | null {
  const max = state.plan.maxStaff
  if (max === null || count <= max) return null
  const next = cheapestPlanForStaff(count)
  const limit = max === 1 ? "1 profesional" : `${max} profesionales`
  return fail(`Tu plan ${state.plan.name} incluye hasta ${limit}. Para sumar más, pasate al plan ${next.name} desde Facturación.`)
}

export type MonthUsage = {
  period: string
  conversations: { used: number; limit: number }
  templates: { used: number; limit: number }
  staff: { used: number; limit: number | null }
}

export async function monthUsage(scoped: ScopedDb, state: BillingState, timezone: string, now: Date): Promise<MonthUsage> {
  const period = usagePeriod(now, timezone)
  const [counter, staff] = await Promise.all([
    scoped.usageCounters.findFirst(eq(schema.usageCounters.period, period)),
    activeStaffCount(scoped),
  ])
  return {
    period,
    conversations: { used: counter?.conversations ?? 0, limit: state.plan.monthlyConversations },
    templates: { used: counter?.templatesSent ?? 0, limit: state.plan.monthlyTemplates },
    staff: { used: staff, limit: state.plan.maxStaff },
  }
}

/** Porcentaje usado, entero (puede pasar de 100). */
export function usagePercent(used: number, limit: number): number {
  return limit > 0 ? Math.floor((used / limit) * 100) : 0
}
