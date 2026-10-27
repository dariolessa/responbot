import { ArrowRight, Sparkles } from "lucide-react"
import Link from "next/link"

import { EmptyState } from "@/components/layout/empty-state"
import { Button } from "@/components/ui/button"
import { cheapestPlanWith, featureLabels, type Feature } from "@/lib/billing/plans"

/** Pantalla de una función que el plan no incluye: qué plan la trae y el botón a Facturación (solo el dueño). */
export function UpgradeNotice({ feature, isOwner }: { feature: Feature; isOwner: boolean }) {
  const plan = cheapestPlanWith(feature)
  return (
    <EmptyState
      icon={Sparkles}
      title={`${featureLabels[feature]} viene con el plan ${plan.name}`}
      description={isOwner ? "Podés cambiar de plan cuando quieras; el cambio es inmediato." : "Pedile al dueño del negocio que cambie de plan."}
      action={
        isOwner ? (
          <Button asChild>
            <Link href="/app/facturacion">
              Ver planes
              <ArrowRight />
            </Link>
          </Button>
        ) : undefined
      }
    />
  )
}
