import { BarChart3, CalendarDays } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"

export const metadata: Metadata = { title: "Estadísticas" }

export default async function EstadisticasPage() {
  await requirePermission("viewStats")

  return (
    <>
      <PageHeader title="Estadísticas" description="Turnos, ingresos e inasistencias del mes." />
      <EmptyState
        icon={BarChart3}
        title="Todavía no hay datos para mostrar"
        description="Con los primeros turnos vas a ver cómo viene el mes."
        action={
          <UpcomingAction>
            <CalendarDays />
            Ver la agenda
          </UpcomingAction>
        }
      />
    </>
  )
}
