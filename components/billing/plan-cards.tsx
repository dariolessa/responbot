import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatUsd, paidPlanIds, plans, type PaidPlanId, type PlanDefinition } from "@/lib/billing/plans"
import { cn } from "@/lib/utils"

/*
 * Tarjetas de los tres planes, con los datos de lib/billing/plans.ts. Las usan
 * la landing (botón para empezar la prueba) y Facturación (botón para elegir).
 */

function limitLines(plan: PlanDefinition): string[] {
  return [
    plan.maxStaff === null ? "Profesionales ilimitados" : plan.maxStaff === 1 ? "1 profesional" : `Hasta ${plan.maxStaff} profesionales`,
    `${plan.monthlyConversations.toLocaleString("es-UY")} conversaciones por mes`,
  ]
}

export function PlanCards({
  current,
  highlight = "pro",
  action,
}: {
  /** Plan contratado (se marca y no muestra botón). */
  current?: PaidPlanId | null
  highlight?: PaidPlanId
  action: (plan: PlanDefinition) => React.ReactNode
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {paidPlanIds.map((id) => {
        const plan = plans[id]
        const featured = id === highlight
        return (
          <div
            key={id}
            className={cn("flex flex-col rounded-[10px] border p-5 sm:p-6", featured && "border-primary ring-1 ring-primary")}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{plan.name}</h3>
              {current === id ? <Badge>Tu plan</Badge> : featured ? <Badge variant="secondary">El más elegido</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{plan.audience}</p>
            <p className="mt-5">
              <span className="font-mono text-3xl font-semibold tracking-tight">{formatUsd(plan.monthlyPriceUsd)}</span>
              <span className="text-sm text-muted-foreground"> /mes</span>
            </p>
            <ul className="mt-5 grid flex-1 content-start gap-2 text-sm">
              {[...limitLines(plan), ...plan.highlights].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.75} />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-6">{action(plan)}</div>
          </div>
        )
      })}
    </div>
  )
}
