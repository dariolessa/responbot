import { eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { SignupResult } from "@/lib/integrations/whatsapp/signup"
import { withCompleted } from "@/lib/onboarding/steps"

/*
 * Conexión de WhatsApp de un negocio (una por negocio en el MVP): se guarda
 * al terminar el alta embebida, con el token y el PIN cifrados, y queda en el
 * log de auditoría.
 */

export class ConnectionError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; cause?: unknown }
    if (e.code === "23505") return true
    current = e.cause
  }
  return false
}

export async function saveWhatsAppConnection(
  scoped: ScopedDb,
  actorId: string,
  result: SignupResult,
  encryptToken: (value: string) => string,
): Promise<schema.WhatsAppAccount> {
  const values = {
    wabaId: result.wabaId,
    phoneNumberId: result.phoneNumberId,
    displayPhone: result.displayPhone,
    verifiedName: result.verifiedName,
    accessTokenEnc: encryptToken(result.token),
    pinEnc: encryptToken(result.pin),
    status: "active" as const,
  }

  let account: schema.WhatsAppAccount | undefined
  try {
    const existing = await scoped.whatsappAccounts.findFirst()
    ;[account] = existing
      ? await scoped.whatsappAccounts.update(eq(schema.whatsappAccounts.id, existing.id), values)
      : await scoped.whatsappAccounts.insert(values)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConnectionError("Ese número ya está conectado a otro negocio.")
    throw error
  }
  if (!account) throw new Error("whatsapp: no se pudo guardar la conexión")

  await scoped.auditLogs.insert({
    actorId,
    action: "whatsapp.connected",
    targetType: "whatsapp_account",
    targetId: account.id,
    metadata: { wabaId: result.wabaId, phoneNumberId: result.phoneNumberId, displayPhone: result.displayPhone },
  })
  const business = await scoped.business()
  if (business && !business.onboardingCompleted.includes("whatsapp")) {
    await scoped.updateBusiness({ onboardingCompleted: withCompleted(business.onboardingCompleted, "whatsapp") })
  }
  return account
}

/** Borra la conexión (el token deja de guardarse). Devuelve la cuenta borrada para avisarle a Meta. */
export async function removeWhatsAppConnection(scoped: ScopedDb, actorId: string) {
  const [account] = await scoped.whatsappAccounts.delete()
  if (!account) return null
  await scoped.auditLogs.insert({
    actorId,
    action: "whatsapp.disconnected",
    targetType: "whatsapp_account",
    targetId: account.id,
    metadata: { wabaId: account.wabaId, displayPhone: account.displayPhone },
  })
  const business = await scoped.business()
  if (business?.onboardingCompleted.includes("whatsapp")) {
    await scoped.updateBusiness({ onboardingCompleted: business.onboardingCompleted.filter((s) => s !== "whatsapp") })
  }
  return account
}
