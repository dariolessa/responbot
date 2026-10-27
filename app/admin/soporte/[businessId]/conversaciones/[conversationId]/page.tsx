import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { adminConversation } from "@/lib/pilots/admin"
import { formatZoned } from "@/lib/time"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Conversación" }
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f-]{36}$/i

const fromLabels = { cliente: "Cliente", bot: "Bot", equipo: "Equipo" } as const

export default async function SupportConversationPage({
  params,
}: PageProps<"/admin/soporte/[businessId]/conversaciones/[conversationId]">) {
  const { businessId, conversationId } = await params
  if (!uuid.test(businessId) || !uuid.test(conversationId)) notFound()
  const data = await adminConversation(businessId, conversationId)
  if (!data) notFound()
  const { business, customer, conversation, messages } = data
  const tz = business.timezone

  return (
    <>
      <div className="mb-8">
        <Link href={`/admin/soporte/${business.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {business.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {customer?.name ?? customer?.phoneE164 ?? "Cliente"}
          {customer?.isTest ? " (chat de prueba)" : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {customer?.phoneE164} · {conversation.mode === "human" ? "la atiende una persona" : "la atiende el bot"} ·
          horario del negocio ({tz}). Se muestran los últimos 200 mensajes.
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="rounded-[10px] border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Esta conversación no tiene mensajes.
        </p>
      ) : (
        <ol className="grid gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "grid max-w-2xl gap-1.5 rounded-[10px] border p-3 text-sm",
                m.from === "cliente" ? "justify-self-start" : "justify-self-end bg-muted/40",
                (m.botError || m.error || m.status === "failed") && "border-destructive/60",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{fromLabels[m.from]}</span>
                <span>{formatZoned(m.at, tz, "d MMM, HH:mm")}</span>
                {m.type !== "text" ? <span>{m.type}</span> : null}
                {m.from !== "cliente" ? <span>{m.status}</span> : null}
                {m.rating ? (
                  <Badge variant={m.rating === "bad" ? "destructive" : "secondary"}>
                    {m.rating === "bad" ? "Mal" : "Bien"}
                  </Badge>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap break-words">{m.text || "—"}</p>
              {m.tools.length > 0 ? (
                <p className="font-mono text-xs text-muted-foreground">
                  Herramientas: {m.tools.map((t) => (t.ok ? t.name : `${t.name} (falló)`)).join(", ")}
                </p>
              ) : null}
              {m.botError ? <p className="font-mono text-xs text-destructive">Error del bot: {m.botError}</p> : null}
              {m.error ? <p className="font-mono text-xs text-destructive">WhatsApp: {m.error}</p> : null}
              {m.ratingNote ? <p className="text-xs text-muted-foreground">Nota del negocio: {m.ratingNote}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
