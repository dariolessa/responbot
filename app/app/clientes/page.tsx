import { UserPlus, UsersRound } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Clientes" }

export default function ClientesPage() {
  return (
    <>
      <PageHeader title="Clientes" description="Visitas, gasto, inasistencias y notas de cada cliente." />
      <EmptyState
        icon={UsersRound}
        title="Todavía no tenés clientes"
        description="Se agregan solos cuando reservan o escriben por WhatsApp."
        action={
          <UpcomingAction>
            <UserPlus />
            Agregar cliente
          </UpcomingAction>
        }
      />
    </>
  )
}
