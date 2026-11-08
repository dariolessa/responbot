"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password"
import { adminCreateDemo, adminExtendTrial, adminSeedMetaReviewer, adminSetPilot, adminStartSupport } from "@/lib/pilots/admin"

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
  revalidatePath(`/admin/soporte/${parsed.data.businessId}`)
}

const trialInput = z.object({
  businessId: z.uuid(),
  days: z.coerce.number().int().min(1).max(90),
})

export async function extendTrialAction(formData: FormData): Promise<void> {
  const parsed = trialInput.safeParse({ businessId: formData.get("businessId"), days: formData.get("days") })
  if (!parsed.success) return
  await adminExtendTrial(parsed.data.businessId, parsed.data.days)
  revalidatePath(`/admin/soporte/${parsed.data.businessId}`)
  redirect(`/admin/soporte/${parsed.data.businessId}?listo=prueba`)
}

const businessInput = z.object({ businessId: z.uuid() })

/** Entra al panel del negocio en modo soporte (queda en su auditoría). */
export async function startSupportAction(formData: FormData): Promise<void> {
  const parsed = businessInput.safeParse({ businessId: formData.get("businessId") })
  if (!parsed.success) return
  const business = await adminStartSupport(parsed.data.businessId)
  if (!business) return
  revalidatePath("/app", "layout")
  redirect("/app/agenda")
}

export async function createDemoAction(): Promise<void> {
  await adminCreateDemo()
  revalidatePath("/admin")
  redirect("/admin?demo=lista")
}

export type ReviewerState = { error?: string; done?: { createdUser: boolean; createdBusiness: boolean } }

const reviewerInput = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, { error: `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "Las dos contraseñas no coinciden." })

/** Crea o actualiza reviewer@responbot.com con la contraseña escrita (App Review de Meta). */
export async function seedMetaReviewerAction(_prev: ReviewerState, formData: FormData): Promise<ReviewerState> {
  const parsed = reviewerInput.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const result = await adminSeedMetaReviewer(parsed.data.password)
  return { done: { createdUser: result.createdUser, createdBusiness: result.createdBusiness } }
}
