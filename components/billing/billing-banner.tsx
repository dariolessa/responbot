import { AlertTriangle, ArrowRight } from "lucide-react"
import Link from "next/link"

import type { BillingState } from "@/lib/billing/state"
import { cn } from "@/lib/utils"

/*
 * Aviso arriba del panel cuando la cuenta necesita algo: prueba por terminar o
 * terminada, pago fallido, suscripción terminada o límite del mes alcanzado.
 * El dueño ve el botón a Facturación; el resto, a quién pedírselo.
 */

function message(state: BillingState, overLimit: boolean): { text: string; warn: boolean } | null {
  switch (state.status) {
    case "trialing":
      if (state.trialDaysLeft !== null && state.trialDaysLeft <= 3) {
        return {
          text:
            state.trialDaysLeft === 0
              ? "Tu prueba termina hoy."
              : `Te quedan ${state.trialDaysLeft} ${state.trialDaysLeft === 1 ? "día" : "días"} de prueba.`,
          warn: false,
        }
      }
      break
    case "trial_expired":
      return { text: "Tu prueba terminó: el bot no toma reservas y el panel está en solo lectura.", warn: true }
    case "past_due":
      return { text: "No pudimos cobrar la suscripción. Actualizá la tarjeta para no perder las reservas.", warn: true }
    case "suspended":
      return { text: "Suscripción impaga: el bot no toma reservas y el panel está en solo lectura.", warn: true }
    case "canceled":
      return { text: "Tu suscripción terminó: el bot no toma reservas y el panel está en solo lectura.", warn: true }
  }
  if (overLimit) return { text: "Llegaste al límite de conversaciones del mes. El bot sigue respondiendo.", warn: false }
  return null
}

export function BillingBanner({ state, overLimit, isOwner }: { state: BillingState; overLimit: boolean; isOwner: boolean }) {
  const shown = message(state, overLimit)
  if (!shown) return null
  return (
    <div
      role="status"
      className={cn(
        "mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border px-4 py-3 text-sm",
        shown.warn
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : "bg-muted/50",
      )}
    >
      {shown.warn ? <AlertTriangle className="size-4 shrink-0" strokeWidth={1.75} /> : null}
      <span className="min-w-0 flex-1">{shown.text}</span>
      {isOwner ? (
        <Link href="/app/facturacion" className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline sm:min-h-0">
          Ver planes
          <ArrowRight className="size-4" />
        </Link>
      ) : (
        <span className="text-muted-foreground">Avisale al dueño del negocio.</span>
      )}
    </div>
  )
}
