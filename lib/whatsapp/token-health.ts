import "server-only"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { checkToken } from "@/lib/integrations/whatsapp/signup"

import { accountToken, graphOptions } from "./deps"

/*
 * Cron diario token-health, parte de WhatsApp: si el token de un negocio ya
 * no sirve, la cuenta pasa a token_expired y Configuración pide reconectar.
 * El aviso por push y correo llega con el despachador de la Fase 4; Mercado
 * Pago, con la Fase 5.
 */
export async function checkWhatsAppTokens() {
  const accounts = await forPlatform(db).activeWhatsAppAccounts()
  let expired = 0
  for (const account of accounts) {
    try {
      if ((await checkToken(account.phoneNumberId, graphOptions(accountToken(account)))) === "invalid") {
        await forBusiness(db, account.businessId).whatsappAccounts.update(undefined, { status: "token_expired" })
        expired++
      }
    } catch (error) {
      // Meta caída o un error pasajero: se vuelve a revisar mañana.
      console.error("[whatsapp] no se pudo revisar el token", account.businessId, error)
    }
  }
  return { checked: accounts.length, expired }
}
