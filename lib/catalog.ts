import { and, eq, inArray, notInArray } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { WeeklyRangeValue } from "@/lib/forms"

/*
 * Servicios, profesionales y horarios. Lo usan el asistente de alta y las
 * pantallas de Servicios y Equipo, así ambos guardan igual.
 */

export type ServiceValues = {
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositOverride?: number | null
  active?: boolean
}

/** Crea un servicio al final del catálogo. */
export async function createService(
  scoped: ScopedDb,
  values: ServiceValues,
  resourceIds: string[] = [],
): Promise<schema.Service> {
  const existing = await scoped.services.findMany({ orderBy: [schema.services.sortOrder] })
  const sortOrder = (existing.at(-1)?.sortOrder ?? -1) + 1
  const [service] = await scoped.services.insert({ ...values, sortOrder })
  await setServiceResources(scoped, service!.id, resourceIds)
  return service!
}

/** Profesionales que hacen un servicio; conserva duración y precio propios de los que siguen. */
export async function setServiceResources(scoped: ScopedDb, serviceId: string, resourceIds: string[]) {
  const valid = resourceIds.length
    ? await scoped.resources.findMany({ where: inArray(schema.resources.id, resourceIds) })
    : []
  const ids = valid.map((r) => r.id)
  await scoped.resourceServices.delete(
    and(
      eq(schema.resourceServices.serviceId, serviceId),
      ids.length ? notInArray(schema.resourceServices.resourceId, ids) : undefined,
    ),
  )
  const current = await scoped.resourceServices.findMany({
    where: eq(schema.resourceServices.serviceId, serviceId),
  })
  const have = new Set(current.map((l) => l.resourceId))
  const missing = ids.filter((id) => !have.has(id))
  if (missing.length) {
    await scoped.resourceServices.insert(missing.map((resourceId) => ({ resourceId, serviceId })))
  }
}

/** Servicios que hace un profesional. */
export async function setResourceServices(scoped: ScopedDb, resourceId: string, serviceIds: string[]) {
  const valid = serviceIds.length
    ? await scoped.services.findMany({ where: inArray(schema.services.id, serviceIds) })
    : []
  const ids = valid.map((s) => s.id)
  await scoped.resourceServices.delete(
    and(
      eq(schema.resourceServices.resourceId, resourceId),
      ids.length ? notInArray(schema.resourceServices.serviceId, ids) : undefined,
    ),
  )
  const current = await scoped.resourceServices.findMany({
    where: eq(schema.resourceServices.resourceId, resourceId),
  })
  const have = new Set(current.map((l) => l.serviceId))
  const missing = ids.filter((id) => !have.has(id))
  if (missing.length) {
    await scoped.resourceServices.insert(missing.map((serviceId) => ({ resourceId, serviceId })))
  }
}

/** Reemplaza el horario semanal de un profesional. */
export async function replaceWorkingHours(
  scoped: ScopedDb,
  resourceId: string,
  ranges: WeeklyRangeValue[],
) {
  await scoped.workingHours.delete(eq(schema.workingHours.resourceId, resourceId))
  if (ranges.length) {
    await scoped.workingHours.insert(ranges.map((r) => ({ ...r, resourceId })))
  }
}

export type StaffValues = {
  name: string
  color?: string | null
  userId?: string | null
  serviceIds: string[]
  hours: WeeklyRangeValue[]
}

/** Alta de un profesional con sus servicios y su horario. */
export async function createStaff(scoped: ScopedDb, values: StaffValues): Promise<schema.Resource> {
  const [resource] = await scoped.resources.insert({
    type: "staff",
    name: values.name,
    color: values.color ?? null,
    userId: values.userId ?? null,
  })
  await setResourceServices(scoped, resource!.id, values.serviceIds)
  await replaceWorkingHours(scoped, resource!.id, values.hours)
  return resource!
}

/** Registro de cambios sensibles (docs/SPEC.md, "Seguridad"). */
export async function audit(
  scoped: ScopedDb,
  entry: {
    actorId: string | null
    action: string
    targetType?: string
    targetId?: string
    metadata?: Record<string, unknown>
  },
) {
  await scoped.auditLogs.insert({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  })
}
