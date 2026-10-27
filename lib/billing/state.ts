import type * as schema from "@/lib/db/schema"

import { GRACE_DAYS, planDefinition, type Feature, type PlanDefinition } from "./plans"

/*
 * En qué situación está la cuenta del negocio con el SaaS (docs/SPEC.md,
 * "Stripe" y "Reglas de facturación"). Función pura: la usan el layout del
 * panel, las server actions, el bot y los crons.
 *
 * - Prueba vigente: todo habilitado.
 * - Prueba vencida sin plan, suscripción terminada o 7 días de pago fallido:
 *   el bot sigue respondiendo consultas pero no reserva y el panel queda en
 *   solo lectura (salvo Facturación, Conversaciones y Notificaciones).
 * - Pago fallido dentro de los 7 días de gracia: funciona igual, con aviso.
 */

export type BillingStatus = "trialing" | "trial_expired" | "active" | "past_due" | "suspended" | "canceled"

export type BillingState = {
  status: BillingStatus
  /** Lo que incluye hoy (la prueba vigente, el plan pago, o el plan pago aunque esté suspendido). */
  plan: PlanDefinition
  /** El bot y el panel pueden crear y mover turnos. */
  canBook: boolean
  /** El panel no deja cambiar datos (agenda, clientes, catálogo, equipo, configuración). */
  readOnly: boolean
  /** Días que le quedan a la prueba (0 el último día); null si no está en prueba. */
  trialDaysLeft: number | null
  /** Hasta cuándo dura la gracia de un pago fallido. */
  graceEndsAt: Date | null
}

export type BillingFields = Pick<
  schema.Business,
  "plan" | "trialEndsAt" | "subscriptionStatus" | "paymentFailedAt"
>

const DAY_MS = 86_400_000

/** Estados de Stripe en los que la suscripción cuenta como paga. */
const paidStatuses = new Set(["active", "trialing"])
const failingStatuses = new Set(["past_due", "unpaid"])

export function billingState(business: BillingFields, now: Date): BillingState {
  const graceEndsAt = business.paymentFailedAt
    ? new Date(business.paymentFailedAt.getTime() + GRACE_DAYS * DAY_MS)
    : null

  if (business.plan !== "trial") {
    const plan = planDefinition(business.plan)
    const status = business.subscriptionStatus ?? "active"
    if (paidStatuses.has(status)) {
      return { status: "active", plan, canBook: true, readOnly: false, trialDaysLeft: null, graceEndsAt: null }
    }
    if (failingStatuses.has(status)) {
      const ends = graceEndsAt ?? new Date(now.getTime() + GRACE_DAYS * DAY_MS)
      const inGrace = ends > now
      return {
        status: inGrace ? "past_due" : "suspended",
        plan,
        canBook: inGrace,
        readOnly: !inGrace,
        trialDaysLeft: null,
        graceEndsAt: ends,
      }
    }
    // canceled, incomplete_expired, paused…: si todavía le queda prueba, sigue en prueba.
    if (!business.trialEndsAt || business.trialEndsAt <= now) {
      return { status: "canceled", plan, canBook: false, readOnly: true, trialDaysLeft: null, graceEndsAt: null }
    }
  }

  const trial = planDefinition("trial")
  if (business.trialEndsAt && business.trialEndsAt > now) {
    const daysLeft = Math.floor((business.trialEndsAt.getTime() - now.getTime()) / DAY_MS)
    return { status: "trialing", plan: trial, canBook: true, readOnly: false, trialDaysLeft: daysLeft, graceEndsAt: null }
  }
  return { status: "trial_expired", plan: trial, canBook: false, readOnly: true, trialDaysLeft: null, graceEndsAt: null }
}

export function hasFeature(state: BillingState, feature: Feature): boolean {
  return state.plan.features[feature]
}

/** Mensaje de error de una acción bloqueada por solo lectura. */
export function readOnlyMessage(state: BillingState): string {
  switch (state.status) {
    case "trial_expired":
      return "Tu prueba terminó. Elegí un plan en Facturación para seguir cargando cambios."
    case "suspended":
      return "No pudimos cobrar tu suscripción. Actualizá la tarjeta en Facturación para seguir cargando cambios."
    case "canceled":
      return "Tu suscripción terminó. Elegí un plan en Facturación para seguir cargando cambios."
    default:
      return "Por ahora no se pueden hacer cambios."
  }
}
