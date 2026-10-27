"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { adminCreateDemo, adminSetPilot } from "@/lib/pilots/admin"

const DAY_MS = 86_400_000

const pilotInput = z.object({
  businessId: z.uuid(),
  /** Días desde hoy; 0 quita el piloto. */
  days: z.coerce.number().int().min(0).max(365),
})

export async function setPilotAction(formData: FormData): Promise<void> {
  const parsed = pilotInput.safeParse({ businessId: formData.get("businessId"), days: formData.get("days") })
  if (!parsed.success) return
  const endsAt = parsed.data.days === 0 ? null : new Date(Date.now() + parsed.data.days * DAY_MS)
  await adminSetPilot(parsed.data.businessId, endsAt)
  revalidatePath("/admin")
}

export async function createDemoAction(): Promise<void> {
  await adminCreateDemo()
  revalidatePath("/admin")
  redirect("/admin?demo=lista")
}
