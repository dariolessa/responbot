import "server-only"

import { forbidden, redirect } from "next/navigation"
import { cache } from "react"

import { auth } from "@/lib/auth"
import { can, type Permission } from "@/lib/auth/roles"
import { db } from "@/lib/db"
import type { Role } from "@/lib/db/schema"
import { forBusiness, forUser, type MembershipWithBusiness, type ScopedDb } from "@/lib/db/scoped"

export type SessionUser = {
  id: string
  email: string
  name: string | null
  image: string | null
}

export type Tenant = {
  user: SessionUser
  role: Role
  business: MembershipWithBusiness
  memberships: MembershipWithBusiness[]
  /** Acceso a datos filtrado por el negocio activo. */
  db: ScopedDb
}

/** Usuario con sesión válida, o redirige a /login. */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const session = await auth()
  const user = session?.user
  if (!user?.id || !user.email) redirect("/login")
  return { id: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null }
})

/**
 * Membresías del usuario, después de aceptar las invitaciones pendientes para
 * su email (docs/SPEC.md, "Flujo de entrada", paso 3).
 */
export const getMemberships = cache(async (user: SessionUser) => {
  const scope = forUser(db, user.id)
  await scope.acceptPendingInvitations(user.email)
  return scope.listMemberships()
})

/**
 * Negocio activo con su scope de datos. Sin negocio, redirige a /onboarding.
 * Es la única puerta de entrada a los datos desde el panel.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  const user = await requireUser()
  const memberships = await getMemberships(user)
  if (memberships.length === 0) redirect("/onboarding")

  const scope = forUser(db, user.id)
  const lastId = await scope.lastBusinessId()
  let business = memberships.find((m) => m.businessId === lastId)
  if (!business) {
    business = memberships[0]!
    await scope.setActiveBusiness(business.businessId)
  }

  return {
    user,
    role: business.role,
    business,
    memberships,
    db: forBusiness(db, business.businessId),
  }
})

/** Igual que getTenant, pero responde 403 si el rol no tiene el permiso. */
export async function requirePermission(permission: Permission): Promise<Tenant> {
  const tenant = await getTenant()
  if (!can(tenant.role, permission)) forbidden()
  return tenant
}
