import "server-only"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { checkToken } from "@/lib/integrations/whatsapp/signup"

import { markWhatsAppBroken } from "./connection"
import { accountToken, graphOptions } from "./deps"

/*
 * Cron diario token-health, parte de WhatsApp: si el token de un negocio ya
 * no sirve, la cuenta pasa a token_expired, Configuración pide reconectar y
 * el despachador avisa a dueño y admins (panel, push y correo). Mercado Pago
 * llega con la Fase 5.
 */
export async function checkWhatsAppTokens() {
  const accounts = await forPlatform(db).activeWhatsAppAccounts()
  const expired: string[] = []
  for (const account of accounts) {
    try {
      if ((await checkToken(account.phoneNumberId, graphOptions(accountToken(account)))) === "invalid") {
        await markWhatsAppBroken(forBusiness(db, account.businessId), "token_expired")
        expired.push(account.businessId)
      }
    } catch (error) {
      // Meta caída o un error pasajero: se vuelve a revisar mañana.
      console.error("[whatsapp] no se pudo revisar el token", account.businessId, error)
    }
  }
  return { checked: accounts.length, expired }
}
