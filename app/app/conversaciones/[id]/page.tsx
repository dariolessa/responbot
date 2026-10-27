import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ThreadView } from "@/components/conversations/thread-view"
import { LiveRefresh } from "@/components/layout/live-refresh"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/auth/tenant"
import { loadThread } from "@/lib/whatsapp/inbox"
import { markConversationRead } from "@/lib/whatsapp/panel"

export const metadata: Metadata = { title: "Conversación" }

export default async function ConversacionPage({ params }: PageProps<"/app/conversaciones/[id]">) {
  const { id } = await params
  const tenant = await requirePermission("handleConversations")
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const thread = await loadThread(tenant, id)
  if (!thread) notFound()
  // Abrirla la marca como leída para el equipo.
  await markConversationRead(tenant.db, thread.id)
  const account = await tenant.db.whatsappAccounts.findFirst()

  return (
    <>
      <LiveRefresh />
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/app/conversaciones">
            <ArrowLeft />
            Conversaciones
          </Link>
        </Button>
      </div>
      <ThreadView
        thread={thread}
        timezone={tenant.business.timezone}
        connected={account?.status === "active"}
      />
    </>
  )
}
