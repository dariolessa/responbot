"use server"

import { revalidatePath } from "next/cache"

import { requirePermission } from "@/lib/auth/tenant"
import { ok, type ActionResult } from "@/lib/forms"
import { removeMpConnection } from "@/lib/payments/mercadopago"

export async function disconnectMercadoPago(): Promise<ActionResult> {
  const tenant = await requirePermission("manageConnections")
  await removeMpConnection(tenant.db, tenant.user.id)
  revalidatePath("/app", "layout")
  return ok()
}
