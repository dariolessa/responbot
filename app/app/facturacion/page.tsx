import { ArrowRight, ExternalLink } from "lucide-react"
import type { Metadata } from "next"

import { PlanCards } from "@/components/billing/plan-cards"
import { UsageMeter } from "@/components/billing/usage-meter"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/auth/tenant"
import { monthUsage } from "@/lib/billing/access"
import { isStripeConfigured } from "@/lib/billing/deps"
import { isPaidPlan } from "@/lib/billing/plans"
import { billingState, type BillingState } from "@/lib/billing/state"
import { hasSubscription } from "@/lib/billing/stripe"
import type { Business } from "@/lib/db/schema"
import { formatZoned } from "@/lib/time"

import { portalAction, subscribeAction } from "./actions"

export const metadata: Metadata = { title: "Facturación" }

const notices: Record<string, { text: string; error?: boolean }> = {
  suscripto: { text: "¡Gracias! Tu suscripción quedó activa. Puede tardar unos segundos en verse acá." },
  error: { text: "No pudimos abrir Stripe. Probá de nuevo en unos minutos.", error: true },
}

function statusLine(state: BillingState, business: Business): { badge: string; text: string; tone?: "warn" } {
  const day = (date: Date) => formatZoned(date, business.timezone, "d 'de' MMMM")
  switch (state.status) {
    case "trialing":
      return {
        badge: "En prueba",
        text:
          state.trialDaysLeft === 0
            ? "Tu prueba termina hoy. Elegí un plan para que el bot siga reservando."
            : `Te quedan ${state.trialDaysLeft} ${state.trialDaysLeft === 1 ? "día" : "días"} de prueba (hasta el ${day(business.trialEndsAt!)}). Si elegís un plan ahora, se empieza a cobrar cuando termina.`,
      }
    case "trial_expired":
      return {
        badge: "Prueba terminada",
        text: "El bot responde consultas pero no reserva, y el panel quedó en solo lectura. Elegí un plan para seguir.",
        tone: "warn",
      }
    case "active":
      return {
        badge: "Activo",
        text: business.cancelAtPeriodEnd && business.currentPeriodEnd
          ? `Cancelaste la suscripción: sigue activa hasta el ${day(business.currentPeriodEnd)}.`
          : business.currentPeriodEnd
            ? `Próximo cobro el ${day(business.currentPeriodEnd)}.`
            : "Tu suscripción está al día.",
      }
    case "past_due":
      return {
        badge: "Pago pendiente",
        text: `No pudimos cobrar la suscripción. Actualizá la tarjeta antes del ${day(state.graceEndsAt!)} para no perder las reservas.`,
        tone: "warn",
      }
    case "suspended":
      return {
        badge: "Suspendido",
        text: "No pudimos cobrar la suscripción: el bot no reserva y el panel quedó en solo lectura. Actualizá la tarjeta para seguir.",
        tone: "warn",
      }
    case "pilot":
      return {
        badge: "Piloto",
        text: state.pilotEndsAt
          ? `Sos parte de los negocios piloto: tenés todo habilitado sin cargo hasta el ${day(state.pilotEndsAt)}. Si elegís un plan ahora, se empieza a cobrar cuando termina.`
          : "Este es un negocio de demostración: tiene todo habilitado y no se cobra.",
      }
    case "canceled":
      return {
        badge: "Sin plan",
        text: "Tu suscripción terminó. El bot responde consultas pero no reserva. Elegí un plan para seguir.",
        tone: "warn",
      }
  }
}

export default async function FacturacionPage({ searchParams }: PageProps<"/app/facturacion">) {
  const { estado } = await searchParams
  const { db, business: membership } = await requirePermission("manageBilling")
  const business = (await db.business())!
  const now = new Date()
  const state = billingState(business, now)
  const usage = await monthUsage(db, state, membership.timezone, now)
  const configured = isStripeConfigured()
  const subscribed = hasSubscription(business)
  const current = state.status === "active" || state.status === "past_due" || state.status === "suspended"
  const status = statusLine(state, business)
  const notice = typeof estado === "string" ? notices[estado] : undefined

  return (
    <>
      <PageHeader title="Facturación" description="Tu plan, el uso del mes y tus pagos." />

      {notice ? (
        <p role="status" className={notice.error ? "mb-6 text-sm text-destructive" : "mb-6 text-sm text-muted-foreground"}>
          {notice.text}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3 rounded-[10px] border p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Plan {state.plan.name}</h2>
            <Badge variant={status.tone === "warn" ? "destructive" : "secondary"}>{status.badge}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{status.text}</p>
          {subscribed && configured ? (
            <form action={portalAction}>
              <Button type="submit" variant="outline" className="w-full sm:w-auto">
                Cambiar plan, tarjeta o cancelar
                <ExternalLink />
              </Button>
            </form>
          ) : null}
        </div>

        <div className="grid content-start gap-4 rounded-[10px] border p-5">
          <h2 className="font-medium">Uso de este mes</h2>
          <UsageMeter label="Conversaciones de WhatsApp" used={usage.conversations.used} limit={usage.conversations.limit} />
          <UsageMeter label="Mensajes con plantilla" used={usage.templates.used} limit={usage.templates.limit} />
          <UsageMeter label="Profesionales activos" used={usage.staff.used} limit={usage.staff.limit} />
          <p className="text-xs text-muted-foreground">
            Si llegás al límite, el bot sigue respondiendo y te avisamos para pasar a un plan más grande.
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Planes</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Precios en dólares, con tarjeta. {subscribed ? "Para cambiar de plan usá el portal: el cambio es inmediato y se prorratea." : ""}
        </p>
        <PlanCards
          current={current && isPaidPlan(business.plan) ? business.plan : null}
          action={(plan) => {
            if (!configured) {
              return (
                <Button disabled className="w-full">
                  Muy pronto
                </Button>
              )
            }
            if (current && business.plan === plan.id) return null
            if (subscribed) {
              return (
                <form action={portalAction}>
                  <Button type="submit" variant="outline" className="w-full">
                    Cambiar a {plan.name}
                  </Button>
                </form>
              )
            }
            return (
              <form action={subscribeAction}>
                <input type="hidden" name="plan" value={plan.id} />
                <Button type="submit" className="w-full" variant={plan.id === "pro" ? "default" : "outline"}>
                  Elegir {plan.name}
                  <ArrowRight />
                </Button>
              </form>
            )
          }}
        />
        {!configured ? (
          <p className="mt-4 text-sm text-muted-foreground">El cobro con tarjeta todavía no está habilitado en Responbot.</p>
        ) : null}
      </section>
    </>
  )
}
