import { Bot, MessageCircle, MessagesSquare, UserRound } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/layout/empty-state"
import { LiveRefresh } from "@/components/layout/live-refresh"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { can } from "@/lib/auth/roles"
import { requirePermission } from "@/lib/auth/tenant"
import { formatZoned, toDateString } from "@/lib/time"
import { cn } from "@/lib/utils"
import { listInbox, type InboxFilter } from "@/lib/whatsapp/inbox"

export const metadata: Metadata = { title: "Conversaciones" }

const filters: { key: InboxFilter; label: string; href: string }[] = [
  { key: "all", label: "Todas", href: "/app/conversaciones" },
  { key: "human", label: "Necesitan una persona", href: "/app/conversaciones?filtro=humano" },
]

function when(iso: string | null, timezone: string, now: Date) {
  if (!iso) return ""
  const at = new Date(iso)
  return toDateString(at, timezone) === toDateString(now, timezone)
    ? formatZoned(at, timezone, "HH:mm")
    : formatZoned(at, timezone, "d MMM")
}

export default async function ConversacionesPage({ searchParams }: PageProps<"/app/conversaciones">) {
  const params = await searchParams
  const tenant = await requirePermission("handleConversations")
  const filter: InboxFilter = params.filtro === "humano" ? "human" : "all"
  const [items, account] = await Promise.all([
    listInbox(tenant, filter),
    tenant.db.whatsappAccounts.findFirst(),
  ])
  const timezone = tenant.business.timezone
  const now = new Date()

  return (
    <>
      <LiveRefresh />
      <PageHeader title="Conversaciones" description="Los chats de WhatsApp con tus clientes." />

      <nav className="mb-4 flex gap-2" aria-label="Filtrar conversaciones">
        {filters.map((f) => (
          <Button key={f.key} asChild size="sm" variant={f.key === filter ? "secondary" : "ghost"}>
            <Link href={f.href} aria-current={f.key === filter ? "page" : undefined}>
              {f.label}
            </Link>
          </Button>
        ))}
      </nav>

      {items.length === 0 ? (
        !account && filter === "all" ? (
          <EmptyState
            icon={MessagesSquare}
            title="Todavía no hay conversaciones"
            description="Cuando conectes WhatsApp, los mensajes de tus clientes aparecen acá."
            action={
              can(tenant.role, "manageConnections") ? (
                <Button asChild>
                  <Link href="/app/configuracion#whatsapp">
                    <MessageCircle />
                    Conectar WhatsApp
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={filter === "human" ? UserRound : MessagesSquare}
            title={filter === "human" ? "Nadie está esperando a una persona" : "Todavía no hay conversaciones"}
            description={
              filter === "human"
                ? "Cuando el bot derive una conversación, aparece acá."
                : "Cuando un cliente te escriba por WhatsApp, aparece acá."
            }
          />
        )
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/conversaciones/${c.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-sm", c.unread > 0 ? "font-semibold" : "font-medium")}>
                      {c.customerName}
                    </span>
                    {c.mode === "human" ? (
                      <Badge variant={c.assignedName ? "secondary" : "outline"} className="shrink-0">
                        <UserRound />
                        {c.assignedToMe ? "Con vos" : (c.assignedName ?? "Necesita una persona")}
                      </Badge>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Bot className="size-3" />
                        Bot
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{c.preview || c.phone}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-xs text-muted-foreground">{when(c.lastMessageAt, timezone, now)}</span>
                  {c.unread > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-xs text-primary-foreground">
                      <span className="sr-only">Sin leer: </span>
                      {c.unread}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
