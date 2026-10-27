import type { BillingStatus } from "@/lib/billing/state"

/** Estado de la cuenta de un negocio, como se muestra en /admin. */
export const statusLabels: Record<BillingStatus, string> = {
  trialing: "En prueba",
  trial_expired: "Prueba terminada",
  active: "Pago",
  past_due: "Pago pendiente",
  suspended: "Suspendido",
  canceled: "Sin plan",
  pilot: "Piloto",
}

export function statusVariant(status: BillingStatus) {
  return status === "trial_expired" || status === "suspended" ? ("destructive" as const) : ("secondary" as const)
}
