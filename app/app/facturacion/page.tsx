import { ArrowRight, CreditCard } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"

export const metadata: Metadata = { title: "Facturación" }

export default async function FacturacionPage() {
  await requirePermission("manageBilling")

  return (
    <>
      <PageHeader title="Facturación" description="Tu plan, el uso del mes y tus pagos." />
      <EmptyState
        icon={CreditCard}
        title="Estás en el período de prueba"
        description="Elegí un plan cuando quieras; tu prueba dura 14 días."
        action={
          <UpcomingAction>
            <ArrowRight />
            Ver planes
          </UpcomingAction>
        }
      />
    </>
  )
}
