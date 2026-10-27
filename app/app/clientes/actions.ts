"use server"

import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getTenant, requirePermission } from "@/lib/auth/tenant"
import { readOnlyFailure } from "@/lib/billing/access"
import { agendaAccess, canSeeCustomer } from "@/lib/booking/access"
import * as schema from "@/lib/db/schema"
import { fail, invalid, ok, type ActionResult } from "@/lib/forms"
import { normalizePhone } from "@/lib/phone"

const customerInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Escribí el nombre." })
    .max(80, { error: "El nombre es muy largo." }),
  phone: z.string().trim().min(6, { error: "Escribí el teléfono." }),
  notes: z
    .string()
    .trim()
    .max(2000, { error: "Las notas son muy largas." })
    .optional()
    .transform((v) => v || null),
})

/** Alta manual de un cliente (dueño y admin; un profesional los suma al darles un turno). */
export async function createCustomer(input: z.input<typeof customerInput>): Promise<ActionResult<{ id: string }>> {
  const tenant = await requirePermission("viewAllAgenda")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = customerInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const phone = normalizePhone(parsed.data.phone, tenant.business.timezone)
  if (!phone) return fail("Revisá el teléfono.", { phone: "Escribí un teléfono válido, por ejemplo 099 123 456." })

  const existing = await tenant.db.customers.findFirst(eq(schema.customers.phoneE164, phone))
  if (existing) {
    return fail("Ya hay un cliente con ese teléfono.", {
      phone: `Es ${existing.name ?? "un cliente"} que ya está cargado.`,
    })
  }
  const [created] = await tenant.db.customers.insert({
    phoneE164: phone,
    name: parsed.data.name,
    notes: parsed.data.notes,
  })
  revalidatePath("/app/clientes")
  return ok({ id: created!.id })
}

const updateInput = customerInput.extend({ id: z.uuid() })

export async function updateCustomer(input: z.input<typeof updateInput>): Promise<ActionResult> {
  const tenant = await getTenant()
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const access = await agendaAccess(tenant)
  const parsed = updateInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { id, name, notes } = parsed.data
  if (!(await canSeeCustomer(tenant.db, access, id))) return fail("No encontramos a ese cliente.")

  const phone = normalizePhone(parsed.data.phone, tenant.business.timezone)
  if (!phone) return fail("Revisá el teléfono.", { phone: "Escribí un teléfono válido, por ejemplo 099 123 456." })
  const clash = await tenant.db.customers.findFirst(
    and(eq(schema.customers.phoneE164, phone), ne(schema.customers.id, id)),
  )
  if (clash) return fail("Ese teléfono es de otro cliente.", { phone: "Ese teléfono ya es de otro cliente." })

  await tenant.db.customers.update(eq(schema.customers.id, id), { name, notes, phoneE164: phone })
  revalidatePath("/app/clientes", "layout")
  return ok()
}
