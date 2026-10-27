import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { StepShell } from "@/components/onboarding/step-shell"
import { getMemberships, requireUser } from "@/lib/auth/tenant"
import { TRIAL_DAYS } from "@/lib/business-options"
import { stepByKey } from "@/lib/onboarding/steps"

import { CreateBusinessForm } from "./create-business-form"

export const metadata: Metadata = { title: "Creá tu negocio" }

/*
 * Paso 1 del asistente de alta: crea el negocio. Los datos se editan después
 * en Configuración.
 */
export default async function OnboardingPage() {
  const user = await requireUser()
  const memberships = await getMemberships(user)
  if (memberships.length > 0) redirect("/app/agenda")

  const firstName = user.name?.split(" ")[0]

  return (
    <StepShell
      step={stepByKey("business")}
      title={`${firstName ? `Hola, ${firstName}. ` : ""}Contanos de tu negocio`}
      description={`Con esto armamos tu panel. Tenés ${TRIAL_DAYS} días de prueba, sin tarjeta.`}
    >
      <CreateBusinessForm />
    </StepShell>
  )
}
