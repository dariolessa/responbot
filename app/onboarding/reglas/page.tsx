import type { Metadata } from "next"

import { RulesForm } from "@/components/forms/rules-form"
import { StepShell } from "@/components/onboarding/step-shell"
import { requirePermission } from "@/lib/auth/tenant"
import { stepByKey } from "@/lib/onboarding/steps"
import { defaultRules, rulesToForm } from "@/lib/rules"

export const metadata: Metadata = { title: "Reglas de reserva" }

export default async function ReglasStepPage() {
  const { db } = await requirePermission("manageBusinessSettings")
  const [business, rules] = await Promise.all([db.business(), db.bookingRules.findFirst()])

  return (
    <StepShell
      step={stepByKey("rules")}
      title="¿Cómo se reserva?"
      description="Estas reglas valen para los turnos que tome el bot. Los valores sugeridos sirven para la mayoría de los negocios."
    >
      <RulesForm
        mode="onboarding"
        currency={business?.currency ?? "UYU"}
        initial={rulesToForm(rules ?? defaultRules)}
      />
    </StepShell>
  )
}
