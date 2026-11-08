import { randomBytes } from "node:crypto"

import { eq, inArray } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb } from "@/lib/db/scoped"

/*
 * Pedido de eliminación de datos de Meta (callback "Data Deletion Request"
 * de la app): llega cuando alguien quita Responbot de su cuenta de Facebook
 * y pide borrar sus datos. El signed_request trae su user_id (con alcance de
 * la app), el mismo que guardamos al hacer el alta embebida de WhatsApp.
 *
 * Qué se borra de cada conexión de WhatsApp hecha por esa persona:
 * - la conexión en sí: token de acceso, PIN, ids de la cuenta y del número;
 * - las conversaciones de WhatsApp de ese negocio, con sus mensajes
 *   (números y textos de los clientes que llegaron por WhatsApp).
 * La agenda del negocio (turnos y fichas de clientes) es de la cuenta de
 * Responbot, no de Facebook: se borra al dar de baja la cuenta (ver la
 * política de privacidad).
 *
 * Se registra cada pedido con un código de confirmación que muestra
 * /eliminacion-datos?code=… Si no hay datos asociados, el pedido queda igual
 * como completado (no había nada que borrar).
 */

export type DeletionOutcome = { code: string; status: schema.DataDeletionRequest["status"] }

/** Código corto y legible (sin 0/O ni 1/I). */
export function newConfirmationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(12)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

export async function handleDataDeletionRequest(
  db: AnyDb,
  metaUserId: string,
  options: {
    now?: Date
    /** Avisarle a Meta que la app deja de recibir webhooks de esa WABA (con el token antes de borrarlo). */
    unsubscribe?: (account: schema.WhatsAppAccount) => Promise<void>
  } = {},
): Promise<DeletionOutcome> {
  const now = options.now ?? new Date()
  const platform = forPlatform(db)
  const request = await platform.dataDeletionRequests.insert({ code: newConfirmationCode(), metaUserId })

  const accounts = await platform.whatsAppAccountsByMetaUserId(metaUserId)
  let conversations = 0
  for (const account of accounts) {
    if (options.unsubscribe) {
      try {
        await options.unsubscribe(account)
      } catch (error) {
        console.warn("[meta] no se pudo desuscribir la WABA al borrar datos", error)
      }
    }
    const scoped = forBusiness(db, account.businessId)
    conversations += await scoped.transaction(async (tx) => {
      // Conversaciones de clientes reales (el cliente ficticio del chat de prueba no es de WhatsApp).
      const real = await tx.customers.findMany({ where: eq(schema.customers.isTest, false) })
      const ids = real.map((c) => c.id)
      const deleted = ids.length > 0 ? await tx.conversations.delete(inArray(schema.conversations.customerId, ids)) : []
      await tx.whatsappAccounts.delete(eq(schema.whatsappAccounts.id, account.id))
      await tx.auditLogs.insert({
        actorId: null,
        action: "meta.data_deletion",
        targetType: "whatsapp_account",
        targetId: account.id,
        metadata: { code: request.code, wabaId: account.wabaId, conversations: deleted.length },
      })
      const business = await tx.business()
      if (business?.onboardingCompleted.includes("whatsapp")) {
        await tx.updateBusiness({ onboardingCompleted: business.onboardingCompleted.filter((s) => s !== "whatsapp") })
      }
      return deleted.length
    })
  }

  const done = await platform.dataDeletionRequests.complete(
    request.id,
    { whatsappAccounts: accounts.length, conversations },
    now,
  )
  return { code: request.code, status: done?.status ?? request.status }
}

export async function dataDeletionStatus(db: AnyDb, code: string) {
  if (!/^[A-Z0-9]{6,40}$/.test(code)) return null
  return forPlatform(db).dataDeletionRequests.byCode(code)
}
