"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { audit, createService, setServiceResources } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { fail, invalid, ok, optionalMoneyInput, serviceInput, type ActionResult } from "@/lib/forms"

const saveServiceInput = serviceInput.extend({
  id: z.uuid().optional(),
  depositOverride: optionalMoneyInput,
  active: z.boolean(),
  resourceIds: z.array(z.uuid()),
})

export async function saveService(input: z.input<typeof saveServiceInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageServices")
  const parsed = saveServiceInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { id, resourceIds, ...values } = parsed.data

  if (id) {
    const before = await tenant.db.services.findById(id)
    if (!before) return fail("Ese servicio ya no existe.")
    await tenant.db.transaction(async (tx) => {
      await tx.services.update(eq(schema.services.id, id), values)
      await setServiceResources(tx, id, resourceIds)
    })
    if (before.price !== values.price || before.depositOverride !== values.depositOverride) {
      await audit(tenant.db, {
        actorId: tenant.user.id,
        action: "service.price_changed",
        targetType: "service",
        targetId: id,
        metadata: {
          from: { price: before.price, depositOverride: before.depositOverride },
          to: { price: values.price, depositOverride: values.depositOverride },
        },
      })
    }
  } else {
    await tenant.db.transaction((tx) => createService(tx, values, resourceIds))
  }
  await markServicesStep(tenant)
  revalidatePath("/app/servicios")
  return ok()
}

async function markServicesStep(tenant: Awaited<ReturnType<typeof requirePermission>>) {
  const business = await tenant.db.business()
  if (business && !business.onboardingCompleted.includes("services")) {
    await tenant.db.updateBusiness({
      onboardingCompleted: [...business.onboardingCompleted, "services"],
    })
  }
}

/** Sube o baja un servicio en el catálogo (el orden en que lo ofrece el bot). */
export async function moveService(input: { id: string; direction: "up" | "down" }): Promise<ActionResult> {
  const tenant = await requirePermission("manageServices")
  const { id, direction } = z
    .object({ id: z.uuid(), direction: z.enum(["up", "down"]) })
    .parse(input)

  const list = await tenant.db.services.findMany({
    orderBy: [schema.services.sortOrder, schema.services.name],
  })
  const index = list.findIndex((s) => s.id === id)
  const swapWith = direction === "up" ? index - 1 : index + 1
  if (index < 0 || swapWith < 0 || swapWith >= list.length) return ok()

  const reordered = [...list]
  ;[reordered[index], reordered[swapWith]] = [reordered[swapWith]!, reordered[index]!]
  await tenant.db.transaction(async (tx) => {
    for (const [i, service] of reordered.entries()) {
      if (service.sortOrder !== i) {
        await tx.services.update(eq(schema.services.id, service.id), { sortOrder: i })
      }
    }
  })
  revalidatePath("/app/servicios")
  return ok()
}

/** Borra un servicio sin turnos; si tiene turnos, lo pausa para no perder el historial. */
export async function deleteService(input: { id: string }): Promise<ActionResult<"deleted" | "paused">> {
  const tenant = await requirePermission("manageServices")
  const { id } = z.object({ id: z.uuid() }).parse(input)
  const service = await tenant.db.services.findById(id)
  if (!service) return fail("Ese servicio ya no existe.")

  const used = await tenant.db.bookings.count(eq(schema.bookings.serviceId, id))
  if (used > 0) {
    await tenant.db.services.update(eq(schema.services.id, id), { active: false })
    revalidatePath("/app/servicios")
    return ok("paused" as const)
  }
  await tenant.db.services.delete(eq(schema.services.id, id))
  await audit(tenant.db, {
    actorId: tenant.user.id,
    action: "service.deleted",
    targetType: "service",
    targetId: id,
    metadata: { name: service.name },
  })
  revalidatePath("/app/servicios")
  return ok("deleted" as const)
}
