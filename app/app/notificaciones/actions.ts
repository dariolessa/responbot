"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { getTenant } from "@/lib/auth/tenant"
import { db } from "@/lib/db"
import { forUser } from "@/lib/db/scoped"
import { fail, invalid, ok, timeInput, type ActionResult } from "@/lib/forms"
import { markAllRead, openNotification, savePrefs } from "@/lib/notifications/inbox"
import { channels } from "@/lib/notifications/types"
import { normalizePhone } from "@/lib/phone"

/* Bandeja y preferencias de avisos de la persona en el negocio activo. */

export async function openNotificationAction(formData: FormData) {
  const tenant = await getTenant()
  const id = z.uuid().safeParse(formData.get("id"))
  const url = id.success ? await openNotification(tenant.db, tenant.user.id, id.data) : null
  revalidatePath("/app", "layout")
  redirect(url ?? "/app/notificaciones")
}

export async function markAllReadAction() {
  const tenant = await getTenant()
  await markAllRead(tenant.db, tenant.user.id)
  revalidatePath("/app", "layout")
}

const channelFlags = z.object(Object.fromEntries(channels.map((c) => [c, z.boolean()])) as Record<
  (typeof channels)[number],
  z.ZodBoolean
>)

const prefsInput = z.object({
  types: z.record(z.string(), channelFlags),
  quietStart: timeInput,
  quietEnd: timeInput,
  phone: z.string().trim().max(30),
})

export type PrefsInput = z.input<typeof prefsInput>

export async function savePreferencesAction(input: PrefsInput): Promise<ActionResult> {
  const tenant = await getTenant()
  const parsed = prefsInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  let phone: string | null = null
  if (parsed.data.phone) {
    phone = normalizePhone(parsed.data.phone, tenant.business.timezone)
    if (!phone) return fail("Revisá el número.", { phone: "Escribí un WhatsApp válido, por ejemplo 099 123 456." })
  }

  await forUser(db, tenant.user.id).setPhone(phone)
  await savePrefs(tenant.db, tenant.user.id, tenant.role, parsed.data)
  revalidatePath("/app/notificaciones")
  return ok()
}
