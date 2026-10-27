"use server"

import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { activeStaffCount, businessBilling, readOnlyFailure, staffLimitFailure } from "@/lib/billing/access"
import { audit, replaceWorkingHours, setResourceServices } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import {
  colorInput,
  emailInput,
  fail,
  invalid,
  ok,
  weeklyHoursInput,
  type ActionResult,
} from "@/lib/forms"
import { withCompleted } from "@/lib/onboarding/steps"
import { inviteMember, revokeInvitation } from "@/lib/team/invitations"

const staffInput = z.object({
  id: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, { error: "Escribí el nombre." })
    .max(60, { error: "El nombre es muy largo." }),
  color: colorInput,
  userId: z.uuid().nullable(),
  active: z.boolean(),
  serviceIds: z.array(z.uuid()),
  hours: weeklyHoursInput,
})

export async function saveStaff(input: z.input<typeof staffInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageTeam")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = staffInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { id, serviceIds, hours, userId, ...values } = parsed.data

  // Solo se puede vincular a alguien que es miembro del negocio y no tiene otra columna.
  if (userId) {
    const members = await tenant.db.members()
    if (!members.some((m) => m.userId === userId && m.active)) {
      return fail("Esa persona no es parte del negocio.")
    }
    const taken = await tenant.db.resources.findFirst(
      and(eq(schema.resources.userId, userId), id ? ne(schema.resources.id, id) : undefined),
    )
    if (taken) return fail(`Esa persona ya tiene su agenda como "${taken.name}".`)
  }

  // Límite de profesionales activos del plan: cuenta al crear uno o al reactivarlo.
  if (values.active) {
    const current = id ? await tenant.db.resources.findById(id) : undefined
    if (!current?.active) {
      const limit = staffLimitFailure(await businessBilling(tenant.db), (await activeStaffCount(tenant.db)) + 1)
      if (limit) return limit
    }
  }

  await tenant.db.transaction(async (tx) => {
    let resourceId = id
    if (resourceId) {
      const [updated] = await tx.resources.update(eq(schema.resources.id, resourceId), {
        ...values,
        userId,
      })
      if (!updated) throw new Error("Profesional inexistente")
    } else {
      const [created] = await tx.resources.insert({ type: "staff", ...values, userId })
      resourceId = created!.id
    }
    await setResourceServices(tx, resourceId, serviceIds)
    await replaceWorkingHours(tx, resourceId, hours)
  })

  const business = await tenant.db.business()
  if (business && !business.onboardingCompleted.includes("team")) {
    await tenant.db.updateBusiness({
      onboardingCompleted: withCompleted(business.onboardingCompleted, "team"),
    })
  }
  revalidatePath("/app", "layout")
  return ok()
}

const inviteInput = z.object({
  email: emailInput,
  role: z.enum(["admin", "staff"], { error: "Elegí un rol." }),
  resourceId: z.uuid().nullable(),
})

export async function invite(input: z.input<typeof inviteInput>): Promise<ActionResult<{ sent: boolean }>> {
  const tenant = await requirePermission("manageTeam")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = inviteInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  if (parsed.data.email === tenant.user.email.toLowerCase()) {
    return fail("Ese es tu propio email.", { email: "Ese es tu propio email." })
  }
  const members = await tenant.db.members()
  if (members.some((m) => m.active && m.email?.toLowerCase() === parsed.data.email)) {
    return fail("Esa persona ya es parte del equipo.", { email: "Ya es parte del equipo." })
  }
  if (parsed.data.resourceId && !(await tenant.db.resources.findById(parsed.data.resourceId))) {
    return fail("Ese profesional ya no existe.")
  }

  const result = await inviteMember(tenant, parsed.data)
  revalidatePath("/app/equipo")
  return ok(result)
}

export async function cancelInvitation(input: { id: string }): Promise<ActionResult> {
  const tenant = await requirePermission("manageTeam")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const { id } = z.object({ id: z.uuid() }).parse(input)
  await revokeInvitation(tenant, id)
  revalidatePath("/app/equipo")
  return ok()
}

const memberInput = z.object({
  membershipId: z.uuid(),
  role: z.enum(["admin", "staff"]).optional(),
  active: z.boolean().optional(),
})

/**
 * Cambia el rol o desactiva a un miembro. El dueño no se toca desde acá
 * (transferir la propiedad es otro flujo) y nadie se cambia a sí mismo.
 * Al desactivar, getTenant() deja de encontrar su membresía en el próximo
 * pedido: pierde el acceso al instante.
 */
export async function updateMember(input: z.input<typeof memberInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageTeam")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = memberInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { membershipId, role, active } = parsed.data

  const membership = await tenant.db.memberships.findById(membershipId)
  if (!membership) return fail("Esa persona ya no está en el equipo.")
  if (membership.role === "owner") return fail("Al dueño no se le puede cambiar el rol ni desactivar.")
  if (membership.userId === tenant.user.id) return fail("No podés cambiar tu propio acceso.")

  await tenant.db.memberships.update(eq(schema.memberships.id, membershipId), {
    ...(role ? { role } : {}),
    ...(active === undefined ? {} : { active }),
  })
  await audit(tenant.db, {
    actorId: tenant.user.id,
    action: active === false ? "member.deactivated" : active ? "member.reactivated" : "member.role_changed",
    targetType: "membership",
    targetId: membershipId,
    metadata: { from: { role: membership.role, active: membership.active }, to: { role, active } },
  })
  revalidatePath("/app/equipo")
  return ok()
}
