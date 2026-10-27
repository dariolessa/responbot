import type { Metadata } from "next"

import { TestChat } from "@/components/chat/test-chat"
import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"
import { cheapestPlanWith } from "@/lib/billing/plans"
import { billingState, hasFeature } from "@/lib/billing/state"
import { loadTestChat } from "@/lib/bot/test-chat"
import { isAnthropicConfigured } from "@/lib/integrations/anthropic/client"

import { AutomationsForm } from "./automations-form"
import { BotSettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Bot" }

// Una respuesta puede usar varias herramientas y tardar unos segundos.
export const maxDuration = 60

export default async function BotPage() {
  const tenant = await requirePermission("manageBot")
  const [settings, chat, business] = await Promise.all([
    tenant.db.botSettings.findFirst(),
    loadTestChat(tenant.db, tenant.user.id),
    tenant.db.business(),
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
