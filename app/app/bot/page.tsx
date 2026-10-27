import { ThumbsDown } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { TestChat } from "@/components/chat/test-chat"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"
import { cheapestPlanWith } from "@/lib/billing/plans"
import { billingState, hasFeature } from "@/lib/billing/state"
import { reviewedReplies } from "@/lib/bot/feedback"
import { loadTestChat } from "@/lib/bot/test-chat"
import { isAnthropicConfigured } from "@/lib/integrations/anthropic/client"
import { formatZoned } from "@/lib/time"

import { AutomationsForm } from "./automations-form"
import { BotSettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Bot" }

// Una respuesta puede usar varias herramientas y tardar unos segundos.
export const maxDuration = 60

export default async function BotPage() {
  const tenant = await requirePermission("manageBot")
  const [settings, chat, business, toImprove] = await Promise.all([
    tenant.db.botSettings.findFirst(),
    loadTestChat(tenant.db, tenant.user.id),
    tenant.db.business(),
    reviewedReplies(tenant.db, { rating: "bad", limit: 10 }),
  ])
  const canReactivate = hasFeature(billingState(business!, new Date()), "reactivation")
  const assistantName = settings?.assistantName ?? "Asistente"

  return (
    <>
      <PageHeader
        title="Bot"
        description="Cómo habla tu asistente, qué sabe responder y un chat para probarlo antes de WhatsApp."
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        <section className="order-2 lg:order-1" aria-labelledby="bot-settings-title">
          <h2 id="bot-settings-title" className="mb-6 font-medium">
            Configuración
          </h2>
          <BotSettingsForm
            initial={{
              assistantName,
              tone: settings?.tone ?? "informal",
              welcomeMessage: settings?.welcomeMessage ?? "",
              faq: settings?.faq ?? [],
              replyHours: settings?.replyHours ?? "always",
              offHoursMessage: settings?.offHoursMessage ?? "",
            }}
          />
          <h2 className="mt-12 mb-2 font-medium">Mensajes automáticos</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Salen por WhatsApp con plantillas aprobadas por Meta. Los clientes que escriben BAJA no los reciben.
          </p>
          <AutomationsForm
            initial={{
              reactivationEnabled: settings?.reactivationEnabled ?? true,
              reviewRequestEnabled: settings?.reviewRequestEnabled ?? false,
              reviewUrl: settings?.reviewUrl ?? "",
              reviewDelayHours: settings?.reviewDelayHours ?? 2,
            }}
            reactivationPlan={canReactivate ? null : cheapestPlanWith("reactivation").name}
          />
          <h2 className="mt-12 mb-2 font-medium">Respuestas a mejorar</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Las que marcaste con “Mal” en Conversaciones. Sumá lo que falte en las preguntas frecuentes o en la
            descripción del servicio y probalo acá al lado.
          </p>
          {toImprove.length === 0 ? (
            <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Todavía no marcaste ninguna respuesta. Abrí una{" "}
              <Link href="/app/conversaciones" className="font-medium text-foreground underline-offset-4 hover:underline">
                conversación
              </Link>{" "}
              y tocá “Mal” debajo de lo que dijo el bot.
            </p>
          ) : (
            <ul className="grid gap-3">
              {toImprove.map((r) => (
                <li key={r.feedbackId} className="grid gap-2 rounded-[10px] border p-4 text-sm">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ThumbsDown className="size-3.5 text-destructive" />
                    <span className="font-mono">{formatZoned(r.at, tenant.business.timezone, "d MMM HH:mm")}</span>
                  </p>
                  {r.customerText ? (
                    <p>
                      <span className="text-muted-foreground">Cliente:</span> {r.customerText}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">Bot:</span> {r.reply}
                  </p>
                  {r.note ? (
                    <p className="rounded-md bg-muted px-3 py-2">
                      <span className="text-muted-foreground">Tendría que haber dicho:</span> {r.note}
                    </p>
                  ) : null}
                  <Link
                    href={`/app/conversaciones/${r.conversationId}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-0"
                  >
                    Ver la conversación
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="order-1 lg:sticky lg:top-6 lg:order-2" aria-labelledby="bot-chat-title">
          <h2 id="bot-chat-title" className="mb-6 font-medium">
            Probalo
          </h2>
          <TestChat initial={chat} configured={isAnthropicConfigured()} assistantName={assistantName} />
        </section>
      </div>
    </>
  )
}
