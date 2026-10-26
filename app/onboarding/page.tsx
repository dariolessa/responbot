import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { getMemberships, requireUser } from "@/lib/auth/tenant"
import { TRIAL_DAYS } from "@/lib/business-options"

import { CreateBusinessForm } from "./create-business-form"

export const metadata: Metadata = { title: "Creá tu negocio" }

/*
 * Primer paso del asistente de alta (docs/SPEC.md, "Asistente de alta").
 * Los pasos siguientes (servicios, equipo, reglas, conexiones) llegan en la Fase 1.
 */
export default async function OnboardingPage() {
  const user = await requireUser()
  const memberships = await getMemberships(user)
  if (memberships.length > 0) redirect("/app/agenda")

  const firstName = user.name?.split(" ")[0]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-8 pb-16 sm:pt-16">
        <div className="w-full max-w-lg">
          <p className="text-sm font-medium text-primary">Paso 1 de 7</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {firstName ? `Hola, ${firstName}. ` : ""}Contanos de tu negocio
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Con esto armamos tu panel. Tenés {TRIAL_DAYS} días de prueba, sin tarjeta.
          </p>
          <div className="mt-10">
            <CreateBusinessForm />
          </div>
        </div>
      </main>
    </div>
  )
}
