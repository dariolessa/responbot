"use server"

import { revalidatePath } from "next/cache"

import { requirePermission } from "@/lib/auth/tenant"
import { fail, ok, type ActionResult } from "@/lib/forms"
import { unsubscribeApp } from "@/lib/integrations/whatsapp/signup"
import { submitMissingTemplates } from "@/lib/integrations/whatsapp/templates"
import { removeWhatsAppConnection } from "@/lib/whatsapp/connection"
import { accountToken, graphOptions } from "@/lib/whatsapp/deps"

export async function disconnectWhatsApp(): Promise<ActionResult> {
  const tenant = await requirePermission("manageConnections")
  const account = await removeWhatsAppConnection(tenant.db, tenant.user.id)
  if (account) {
    try {
      await unsubscribeApp(account.wabaId, graphOptions(accountToken(account)))
    } catch (error) {
      // Ya no guardamos el token; si Meta no respondió, los eventos que lleguen se ignoran.
      console.warn("[whatsapp] no se pudo desuscribir la app", error)
    }
  }
  revalidatePath("/app/configuracion")
  return ok()
}

export async function submitTemplates(): Promise<ActionResult<{ submitted: number }>> {
  const tenant = await requirePermission("manageConnections")
  const account = await tenant.db.whatsappAccounts.findFirst()
  if (!account || account.status !== "active") return fail("Primero conectá WhatsApp.")
  try {
    const result = await submitMissingTemplates(account.wabaId, graphOptions(accountToken(account)))
    revalidatePath("/app/configuracion")
    if (result.failed.length > 0) {
      return fail(`Meta no aceptó ${result.failed.map((f) => f.name).join(", ")}: ${result.failed[0]!.error}`)
    }
    return ok({ submitted: result.submitted.length })
  } catch {
    return fail("No pudimos hablar con Meta. Probá de nuevo en unos minutos.")
  }
}
