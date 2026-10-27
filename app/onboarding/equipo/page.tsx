import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { StepShell } from "@/components/onboarding/step-shell"
import { requirePermission } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"
import { summarizeHours } from "@/lib/hours"
import { stepByKey } from "@/lib/onboarding/steps"

import { TeamStep } from "./team-step"

export const metadata: Metadata = { title: "Tu equipo" }

export default async function EquipoStepPage() {
  const { db, user } = await requirePermission("manageTeam")
  const [services, resources, hours] = await Promise.all([
    db.services.findMany({ orderBy: [schema.services.sortOrder, schema.services.name] }),
    db.resources.findMany({ orderBy: [schema.resources.name] }),
    db.workingHours.findMany(),
  ])
  if (services.length === 0) redirect("/onboarding/servicios")

  return (
    <StepShell
      step={stepByKey("team")}
      title="¿Quién atiende y en qué horario?"
      description="Sumá a cada profesional con los servicios que hace y su horario de la semana. Si querés que entren al panel, invitalos por email."
      wide
    >
      <TeamStep
        me={{ name: user.name ?? "", email: user.email }}
        services={services.map((s) => ({ id: s.id, name: s.name }))}
        existing={resources.map((r) => ({
          id: r.id,
          name: r.name,
          isMe: r.userId === user.id,
          hours: summarizeHours(hours.filter((h) => h.resourceId === r.id)),
        }))}
      />
    </StepShell>
  )
}
