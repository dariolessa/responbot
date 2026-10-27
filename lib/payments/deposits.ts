import type * as schema from "@/lib/db/schema"

/*
 * Cuánto se pide de seña (docs/SPEC.md, "Señas"):
 *
 * - El negocio define seña fija o porcentaje (booking_rules) y cada servicio
 *   puede tener la suya (services.deposit_override, en centésimos; 0 = ese
 *   servicio no lleva seña).
 * - Un cliente con varias inasistencias (booking_rules.no_show_deposit_threshold)
 *   paga la seña general aunque el servicio no la pida.
 * - Nunca más que el precio. Sin Mercado Pago conectado no hay seña.
 */

type Rules = Pick<schema.BookingRules, "depositMode" | "depositValue" | "noShowDepositThreshold">

/** Seña de la regla general para un precio (0 si no hay). */
export function generalDeposit(rules: Rules | undefined, price: number): number {
  if (!rules || rules.depositMode === "none") return 0
  if (rules.depositMode === "fixed") return rules.depositValue
  return Math.round((price * rules.depositValue) / 100)
}

export function depositFor(input: {
  rules: Rules | undefined
  price: number
  depositOverride: number | null
  customerNoShows?: number
}): number {
  if (input.price <= 0) return 0
  let amount = input.depositOverride ?? generalDeposit(input.rules, input.price)
  const threshold = input.rules?.noShowDepositThreshold
  if (amount <= 0 && threshold && (input.customerNoShows ?? 0) >= threshold) {
    amount = generalDeposit(input.rules, input.price)
  }
  return Math.max(0, Math.min(amount, input.price))
}
