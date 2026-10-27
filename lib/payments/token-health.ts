import "server-only"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"

import { accessToken, HEALTH_REFRESH_BEFORE_MS, PaymentError, type PaymentDeps } from "./mercadopago"

/*
 * Cron diario token-health, parte de Mercado Pago: renueva los tokens que
 * vencen en los próximos 30 días. Si Mercado Pago rechaza la renovación, la
 * cuenta pasa a token_expired y se avisa a dueño y admins (panel y correo).
 */
export async function checkMercadoPagoTokens(deps: PaymentDeps | null, now: Date = new Date()) {
  if (!deps) return { checked: 0, refreshed: 0, expired: [] as string[] }
  const accounts = await forPlatform(db).mpAccountsExpiringBefore(new Date(now.getTime() + HEALTH_REFRESH_BEFORE_MS))
  let refreshed = 0
  const expired: string[] = []
  for (const { id, businessId } of accounts) {
    const scoped = forBusiness(db, businessId)
    const account = await scoped.mpAccounts.findById(id)
    if (!account) continue
    try {
      await accessToken(scoped, account, deps, now, HEALTH_REFRESH_BEFORE_MS)
      refreshed++
    } catch (error) {
      if (error instanceof PaymentError) expired.push(businessId)
      else console.error("[mercadopago] no se pudo renovar el token", businessId, error)
    }
  }
  return { checked: accounts.length, refreshed, expired }
}
