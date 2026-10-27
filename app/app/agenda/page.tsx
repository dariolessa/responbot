import { CalendarDays, Plus } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Agenda" }

export default function AgendaPage() {
  return (
    <>
      <PageHeader title="Agenda" description="Tus turnos del día, la semana o en lista." />
      <EmptyState
        icon={CalendarDays}
        title="Todavía no hay turnos hoy"
        description="Cuando reserves un turno o lo tome el bot, lo vas a ver acá."
        action={
          <UpcomingAction>
            <Plus />
            Crear turno
          </UpcomingAction>
        }
      />
    </>
  )
}
