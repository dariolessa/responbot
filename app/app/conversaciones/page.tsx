import { MessageCircle, MessagesSquare } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState, UpcomingAction } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Conversaciones" }

export default function ConversacionesPage() {
  return (
    <>
      <PageHeader title="Conversaciones" description="Los chats de WhatsApp con tus clientes." />
      <EmptyState
        icon={MessagesSquare}
        title="Todavía no hay conversaciones"
        description="Cuando conectes WhatsApp, los mensajes de tus clientes aparecen acá."
        action={
          <UpcomingAction>
            <MessageCircle />
            Conectar WhatsApp
          </UpcomingAction>
        }
      />
    </>
  )
}
