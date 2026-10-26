import { Bot, Sparkles } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"

export const metadata: Metadata = { title: "Bot" }

export default async function BotPage() {
  await requirePermission("manageBot")

  return (
    <>
      <PageHeader title="Bot" description="Tono, bienvenida, preguntas frecuentes y chat de prueba." />
      <EmptyState
        icon={Bot}
        title="Tu asistente todavía no está configurado"
        description="Elegí cómo habla y probalo antes de conectarlo a WhatsApp."
        action={
          <UpcomingAction>
            <Sparkles />
            Configurar el bot
          </UpcomingAction>
        }
      />
    </>
  )
}
