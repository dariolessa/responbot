import { UserPlus, Users } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"

export const metadata: Metadata = { title: "Equipo" }

export default async function EquipoPage() {
  await requirePermission("manageTeam")

  return (
    <>
      <PageHeader title="Equipo" description="Profesionales, horarios, invitaciones y roles." />
      <EmptyState
        icon={Users}
        title="Todavía no sumaste a tu equipo"
        description="Agregá a los profesionales y sus horarios para empezar a dar turnos."
        action={
          <UpcomingAction>
            <UserPlus />
            Invitar a alguien
          </UpcomingAction>
        }
      />
    </>
  )
}
