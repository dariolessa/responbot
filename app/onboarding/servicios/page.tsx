import type { Metadata } from "next"

import { StepShell } from "@/components/onboarding/step-shell"
import { requirePermission } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"
import { stepByKey } from "@/lib/onboarding/steps"

import { ServicesStep } from "./services-step"

export const metadata: Metadata = { title: "Tus servicios" }

export default async function ServiciosStepPage() {
  const { db } = await requirePermission("manageServices")
  const [business, services] = await Promise.all([
    db.business(),
    db.services.findMany({ orderBy: [schema.services.sortOrder, schema.services.name] }),
  ])

  return (
    <StepShell
      step={stepByKey("services")}
      title="¿Qué servicios ofrecés?"
      description="Elegí tu tipo de negocio y te proponemos una lista para empezar. Ajustá nombres, duraciones y precios; después lo podés cambiar cuando quieras."
      wide
    >
      <ServicesStep
        currency={business?.currency ?? "UYU"}
        initialCategory={business?.category ?? null}
        existing={services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMinutes: s.durationMinutes,
          price: s.price,
        }))}
      />
    </StepShell>
  )
}
