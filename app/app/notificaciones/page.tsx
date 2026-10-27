import { Bell, SlidersHorizontal } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Notificaciones" }

export default function NotificacionesPage() {
  return (
    <>
      <PageHeader title="Notificaciones" description="Avisos del negocio y cómo querés recibirlos." />
      <EmptyState
        icon={Bell}
        title="No tenés notificaciones"
        description="Te avisamos acá de reservas nuevas, cancelaciones y derivaciones."
        action={
          <UpcomingAction>
            <SlidersHorizontal />
            Elegir canales
          </UpcomingAction>
        }
      />
    </>
  )
}
