import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { StepShell } from "@/components/onboarding/step-shell"
import { getMemberships, requireUser } from "@/lib/auth/tenant"
import { TRIAL_DAYS } from "@/lib/business-options"
import { stepByKey } from "@/lib/onboarding/steps"
import { supportBusiness } from "@/lib/support/mode"

import { CreateBusinessForm } from "./create-business-form"

export const metadata: Metadata = { title: "Creá tu negocio" }

/*
 * Paso 1 del asistente de alta: crea el negocio. Los datos se editan después
 * en Configuración.
 */
export default async function OnboardingPage() {
  const user = await requireUser()
  // En modo soporte no se crean negocios: se trabaja sobre el del cliente.
  if (await supportBusiness(user.email)) redirect("/app/agenda")
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
