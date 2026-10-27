import { ArrowRight, Settings } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Configuración" }

export default function ConfiguracionPage() {
  return (
    <>
      <PageHeader title="Configuración" description="Negocio, reglas de reserva, conexiones y tu cuenta." />
      <EmptyState
        icon={Settings}
        title="Falta completar la configuración"
        description="Definí tus reglas de reserva y conectá WhatsApp y Mercado Pago."
        action={
          <UpcomingAction>
            <ArrowRight />
            Completar configuración
          </UpcomingAction>
        }
      />
    </>
  )
}
