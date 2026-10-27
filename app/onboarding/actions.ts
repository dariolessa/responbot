"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { getMemberships, requireUser } from "@/lib/auth/tenant"
import { currencyOptions, timezoneOptions, TRIAL_DAYS } from "@/lib/business-options"
import { db } from "@/lib/db"
import { forUser } from "@/lib/db/scoped"
import { businessSlug } from "@/lib/slug"

const values = <T extends readonly { value: string }[]>(options: T) =>
  options.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]]

const createBusinessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Escribí el nombre del negocio." })
    .max(80, { error: "El nombre es muy largo." }),
  // En el MVP solo está disponible el arquetipo de servicios con turno.
  archetype: z.literal("services", { error: "Elegí un rubro disponible." }),
  timezone: z.enum(values(timezoneOptions), { error: "Elegí una zona horaria." }),
  currency: z.enum(values(currencyOptions), { error: "Elegí una moneda." }),
})

export type CreateBusinessState = {
  errors?: Partial<Record<keyof z.infer<typeof createBusinessSchema>, string>>
  values?: Record<string, string>
}

export async function createBusiness(
  _prev: CreateBusinessState,
  formData: FormData,
): Promise<CreateBusinessState> {
  const user = await requireUser()
  const raw = Object.fromEntries(
    ["name", "archetype", "timezone", "currency"].map((k) => [k, String(formData.get(k) ?? "")]),
  )
  const parsed = createBusinessSchema.safeParse(raw)
  if (!parsed.success) {
    const errors: CreateBusinessState["errors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<CreateBusinessState["errors"]>
      errors[key] ??= issue.message
    }
    return { errors, values: raw }
  }

  // Si ya pertenece a un negocio (por ejemplo, aceptó una invitación), no crea otro acá.
  const memberships = await getMemberships(user)
  if (memberships.length === 0) {
    await forUser(db, user.id).createBusiness({
      ...parsed.data,
      slug: businessSlug(parsed.data.name),
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    })
  }
  redirect("/app/agenda")
}
