"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { currencyOptions, timezoneOptions } from "@/lib/business-options"
import { audit } from "@/lib/catalog"
import { fail, invalid, ok, type ActionResult } from "@/lib/forms"
import { categoryKeys } from "@/lib/onboarding/templates"
import { nextStepHref, withCompleted } from "@/lib/onboarding/steps"
import { rulesInput, type RulesFormValues } from "@/lib/rules"

/** Reglas de reserva: paso 4 del alta y Configuración. */
export async function saveRules(
  values: RulesFormValues,
  from: "onboarding" | "settings",
): Promise<ActionResult> {
  const tenant = await requirePermission("manageBusinessSettings")
  const parsed = rulesInput.safeParse(values)
  if (!parsed.success) return invalid(parsed.error)

  const existing = await tenant.db.bookingRules.findFirst()
  if (existing) await tenant.db.bookingRules.update(undefined, parsed.data)
  else await tenant.db.bookingRules.insert(parsed.data)
  await audit(tenant.db, {
    actorId: tenant.user.id,
    action: "booking_rules.updated",
    metadata: parsed.data,
  })

  const business = await tenant.db.business()
  await tenant.db.updateBusiness({
    onboardingCompleted: withCompleted(business?.onboardingCompleted ?? [], "rules"),
  })
  revalidatePath("/app", "layout")
  if (from === "onboarding") redirect(nextStepHref("rules"))
  return ok()
}

const values = <T extends readonly { value: string }[]>(options: T) =>
  options.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]]

const businessInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Escribí el nombre del negocio." })
    .max(80, { error: "El nombre es muy largo." }),
  address: z
    .string()
    .trim()
    .max(160, { error: "La dirección es muy larga." })
    .transform((v) => v || null),
  category: z
    .enum(categoryKeys)
    .nullable()
    .or(z.literal("").transform(() => null)),
  timezone: z.enum(values(timezoneOptions), { error: "Elegí una zona horaria." }),
  currency: z.enum(values(currencyOptions), { error: "Elegí una moneda." }),
})

export async function saveBusiness(input: z.input<typeof businessInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageBusinessSettings")
  const parsed = businessInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const before = await tenant.db.business()
  if (!before) return fail("No encontramos el negocio.")
  await tenant.db.updateBusiness(parsed.data)
  if (before.currency !== parsed.data.currency) {
    // Cambiar de moneda no convierte precios: queda registrado.
    await audit(tenant.db, {
      actorId: tenant.user.id,
      action: "business.currency_changed",
      metadata: { from: before.currency, to: parsed.data.currency },
    })
  }
  revalidatePath("/app", "layout")
  return ok()
}
