import { and, eq, inArray, sql } from "drizzle-orm"

import { can } from "@/lib/auth/roles"
import type { Tenant } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

/*
 * Qué parte de la agenda ve cada rol (docs/SPEC.md, "Roles" y "Panel y
 * agenda"): dueño y admin ven todas las columnas; un profesional ve y gestiona
 * solo la suya y sus clientes.
 */

export type AgendaAccess = {
  /** true = todas las columnas. */
  all: boolean
  /** Columnas propias (para un profesional; vacío si no tiene una asignada). */
  resourceIds: string[]
}

type AccessTenant = Pick<Tenant, "role" | "user"> & { db: ScopedDb }

export async function agendaAccess(tenant: AccessTenant): Promise<AgendaAccess> {
  if (can(tenant.role, "viewAllAgenda")) return { all: true, resourceIds: [] }
  const own = await tenant.db.resources.findMany({
    where: eq(schema.resources.userId, tenant.user.id),
  })
  return { all: false, resourceIds: own.map((r) => r.id) }
}

export function canUseResource(access: AgendaAccess, resourceId: string | null): boolean {
  if (access.all) return true
  return resourceId !== null && access.resourceIds.includes(resourceId)
}

/** Condición para filtrar turnos por las columnas visibles. */
export function bookingsVisibleWhere(access: AgendaAccess) {
  if (access.all) return undefined
  if (access.resourceIds.length === 0) return sql`false`
  return inArray(schema.bookings.resourceId, access.resourceIds)
}

/** Clientes visibles: todos, o los que tienen algún turno con las columnas del profesional. */
export function customersVisibleWhere(access: AgendaAccess) {
  if (access.all) return undefined
  if (access.resourceIds.length === 0) return sql`false`
  return sql`exists (select 1 from ${schema.bookings} where ${schema.bookings.customerId} = ${schema.customers.id} and ${inArray(schema.bookings.resourceId, access.resourceIds)})`
}

/** ¿Este cliente es visible para quien pregunta? */
export async function canSeeCustomer(scoped: ScopedDb, access: AgendaAccess, customerId: string) {
  const row = await scoped.customers.findFirst(
    and(eq(schema.customers.id, customerId), customersVisibleWhere(access)),
  )
  return Boolean(row)
}
