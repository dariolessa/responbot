"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/tenant"

import { endSupport } from "./mode"

/** Sale del modo soporte y vuelve a la ficha del negocio en /admin. */
export async function endSupportAction(): Promise<void> {
  const user = await requireUser()
  const businessId = await endSupport({ userId: user.id, email: user.email })
  revalidatePath("/app", "layout")
  redirect(businessId ? `/admin/soporte/${businessId}` : "/admin/soporte")
}
