"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { createService, createStaff } from "@/lib/catalog"
import { emailInput, fail, invalid, serviceInput, weeklyHoursInput, type ActionFailure } from "@/lib/forms"
import { categoryKeys } from "@/lib/onboarding/templates"
import { nextStepHref, withCompleted, type StepKey } from "@/lib/onboarding/steps"
import { inviteMember } from "@/lib/team/invitations"

/*
 * Pasos 2 y 3 del asistente de alta. Cada paso guarda al avanzar y queda
 * marcado en businesses.onboarding_completed.
 */

async function markCompleted(tenant: Awaited<ReturnType<typeof requirePermission>>, key: StepKey) {
  const business = await tenant.db.business()
  await tenant.db.updateBusiness({
    onboardingCompleted: withCompleted(business?.onboardingCompleted ?? [], key),
  })
}

const servicesStepSchema = z.object({
  category: z.enum(categoryKeys).nullable(),
  services: z.array(serviceInput).max(50, { error: "Son demasiados servicios de una vez." }),
})

export async function saveServicesStep(input: z.input<typeof servicesStepSchema>): Promise<ActionFailure> {
  const tenant = await requirePermission("manageServices")
  const parsed = servicesStepSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const existing = await tenant.db.services.count()
  if (existing === 0 && parsed.data.services.length === 0) {
    return fail("Elegí o agregá al menos un servicio.")
  }

  // Los profesionales que ya existan hacen todos los servicios nuevos; se ajusta en el paso 3.
  const resources = await tenant.db.resources.findMany()
  await tenant.db.transaction(async (tx) => {
    if (parsed.data.category) await tx.updateBusiness({ category: parsed.data.category })
    for (const service of parsed.data.services) {
      await createService(
        tx,
        { ...service },
        resources.map((r) => r.id),
      )
    }
  })
  await markCompleted(tenant, "services")
  revalidatePath("/app", "layout")
  redirect(nextStepHref("services"))
}

const teamStepSchema = z.object({
  members: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(2, { error: "Escribí el nombre." })
          .max(60, { error: "El nombre es muy largo." }),
        isMe: z.boolean(),
        email: z
          .string()
          .trim()
          .optional()
          .transform((v) => v || null)
          .pipe(emailInput.nullable()),
        serviceIds: z.array(z.uuid()),
        hours: weeklyHoursInput,
      }),
    )
    .max(30),
})

export async function saveTeamStep(input: z.input<typeof teamStepSchema>): Promise<ActionFailure> {
  const tenant = await requirePermission("manageTeam")
  const parsed = teamStepSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { members } = parsed.data

  const existing = await tenant.db.resources.count()
  if (existing === 0 && members.length === 0) return fail("Agregá al menos a una persona que atienda.")
  if (members.filter((m) => m.isMe).length > 1) return fail("Solo una persona puede ser vos.")
  const withoutHours = members.findIndex((m) => m.hours.length === 0)
  if (withoutHours >= 0) {
    return fail("Cada profesional necesita al menos un día con horario.", {
      [`members.${withoutHours}.hours`]: "Marcá al menos un día.",
    })
  }
  const withoutServices = members.findIndex((m) => m.serviceIds.length === 0)
  if (withoutServices >= 0) {
    return fail("Cada profesional tiene que hacer al menos un servicio.", {
      [`members.${withoutServices}.serviceIds`]: "Elegí al menos un servicio.",
    })
  }

  const created = await tenant.db.transaction(async (tx) => {
    const out: { resourceId: string; email: string | null }[] = []
    for (const member of members) {
      const resource = await createStaff(tx, {
        name: member.name,
        userId: member.isMe ? tenant.user.id : null,
        serviceIds: member.serviceIds,
        hours: member.hours,
      })
      out.push({ resourceId: resource.id, email: member.isMe ? null : member.email })
    }
    return out
  })

  for (const { resourceId, email } of created) {
    if (email && email !== tenant.user.email.toLowerCase()) {
      await inviteMember(tenant, { email, role: "staff", resourceId })
    }
  }

  await markCompleted(tenant, "team")
  revalidatePath("/app", "layout")
  redirect(nextStepHref("team"))
}

/** "Seguir" en un paso que ya tiene datos, sin agregar nada. */
export async function continueStep(key: "services" | "team"): Promise<ActionFailure> {
  const tenant = await requirePermission(key === "services" ? "manageServices" : "manageTeam")
  const count = key === "services" ? await tenant.db.services.count() : await tenant.db.resources.count()
  if (count === 0) {
    return fail(key === "services" ? "Agregá al menos un servicio." : "Agregá al menos a una persona.")
  }
  await markCompleted(tenant, key)
  redirect(nextStepHref(key))
}
