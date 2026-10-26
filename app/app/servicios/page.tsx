import { Plus, Scissors } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"

export const metadata: Metadata = { title: "Servicios" }

export default async function ServiciosPage() {
  await requirePermission("manageServices")

  return (
    <>
      <PageHeader title="Servicios" description="Precio, duración y seña de lo que ofrecés." />
      <EmptyState
        icon={Scissors}
        title="Todavía no cargaste servicios"
        description="Cargá lo que ofrecés para que el bot pueda cotizar y reservar."
        action={
          <UpcomingAction>
            <Plus />
            Crear servicio
          </UpcomingAction>
        }
      />
    </>
  )
}
