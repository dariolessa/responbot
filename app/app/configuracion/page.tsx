import { CreditCard, MessageCircle } from "lucide-react"
import type { Metadata } from "next"

import { RulesForm } from "@/components/forms/rules-form"
import { PageHeader } from "@/components/layout/page-header"
import { PendingStepsCard } from "@/components/onboarding/pending-steps"
import { Badge } from "@/components/ui/badge"
import { can, roleLabels } from "@/lib/auth/roles"
import { getTenant } from "@/lib/auth/tenant"
import { defaultRules, rulesToForm } from "@/lib/rules"

import { BusinessForm } from "./business-form"

export const metadata: Metadata = { title: "Configuración" }

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-6 border-t py-8 first:border-t-0 first:pt-0 md:grid-cols-[16rem_1fr] md:gap-10">
      <div>
        <h2 className="font-medium">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export default async function ConfiguracionPage() {
  const { db, role, user } = await getTenant()
  const manage = can(role, "manageBusinessSettings")
  const [business, rules] = manage
    ? await Promise.all([db.business(), db.bookingRules.findFirst()])
    : [null, null]

  return (
    <>
      <PageHeader
        title="Configuración"
        description={manage ? "Negocio, reglas de reserva, conexiones y tu cuenta." : "Tu cuenta."}
      />
      {business ? <PendingStepsCard completed={business.onboardingCompleted} /> : null}

      {business ? (
        <>
          <Section title="Negocio" description="Cómo se presenta tu negocio y en qué zona horaria trabaja.">
            <BusinessForm
              initial={{
                name: business.name,
                address: business.address ?? "",
                category: business.category ?? "",
                timezone: business.timezone,
                currency: business.currency,
              }}
            />
          </Section>
          <Section
            title="Reglas de reserva"
            description="Anticipación, días hacia adelante, descanso entre turnos, cancelación y seña."
          >
            <RulesForm
              mode="settings"
              currency={business.currency}
              initial={rulesToForm(rules ?? defaultRules)}
            />
          </Section>
          <Section title="Conexiones" description="WhatsApp para el bot y Mercado Pago para las señas.">
            <ul className="grid gap-3">
              {[
                { icon: MessageCircle, name: "WhatsApp", text: "Tu número para que el bot responda." },
                { icon: CreditCard, name: "Mercado Pago", text: "Para cobrar señas al reservar." },
              ].map(({ icon: Icon, name, text }) => (
                <li key={name} className="flex items-center gap-3 rounded-lg border p-4">
                  <Icon className="size-5 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{name}</span>
                    <span className="block text-sm text-muted-foreground">{text}</span>
                  </span>
                  <Badge variant="secondary">Muy pronto</Badge>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <Section title="Tu cuenta">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Nombre</dt>
            <dd>{user.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rol en este negocio</dt>
            <dd>{roleLabels[role]}</dd>
          </div>
        </dl>
      </Section>
    </>
  )
}
