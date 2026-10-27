import "server-only"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { runBillingHourly } from "@/lib/billing/lifecycle"
import { expireOldWaitlist } from "@/lib/booking/waitlist"
import { paymentDeps } from "@/lib/payments/deps"
import { PURGE_HOUR, purgeOldMessages } from "@/lib/privacy"
import { formatZoned } from "@/lib/time"
import { checkMercadoPagoTokens } from "@/lib/payments/token-health"
import { expireHolds } from "@/lib/payments/mercadopago"
import { checkWhatsAppTokens } from "@/lib/whatsapp/token-health"
import { MAX_ATTEMPTS } from "@/lib/whatsapp/scheduled"

import { deliveryDeps, flushBusiness } from "./deps"
import { runHourlyForBusiness } from "./summaries"

/*
 * Trabajo de los crons (vercel.json). Cada negocio se procesa con su scope;
 * forPlatform solo dice cuáles tienen algo que hacer. Se corta antes de los
 * 60 segundos de la función: lo que quede sale en la próxima vuelta.
 */

const BUDGET_MS = 50_000

async function forEachBusiness<T>(ids: string[], work: (id: string) => Promise<T>) {
  const started = Date.now()
  let done = 0
  let failed = 0
  for (const id of ids) {
    if (Date.now() - started > BUDGET_MS) break
    try {
      await work(id)
      done++
    } catch (error) {
      failed++
      console.error("[cron] falló un negocio", id, error)
    }
  }
  return { businesses: ids.length, done, failed }
}

/** Cada 5 minutos: recordatorios y mensajes programados vencidos, y avisos sin entregar. */
export async function runScheduledMessages(now = new Date()) {
  const ids = await forPlatform(db).businessesWithPendingWork(now, MAX_ATTEMPTS)
  const deps = deliveryDeps()
  return forEachBusiness(ids, (id) => flushBusiness(db, id, deps, now))
}

/**
 * Cada hora: resumen diario y semanal a las 8:00 locales, correos de alta
 * incompleta y de fin de prueba, avisos de uso del plan, reactivaciones y
 * el borrado de mensajes de más de 12 meses.
 */
export async function runDailySummary(now = new Date()) {
  const businesses = await forPlatform(db).businessesForCron()
  const deps = deliveryDeps()
  const timezones = new Map(businesses.map((b) => [b.id, b.timezone]))
  return forEachBusiness(
    businesses.map((b) => b.id),
    async (id) => {
      const scoped = forBusiness(db, id)
      await expireOldWaitlist(scoped, timezones.get(id)!, now)
      const result = await runHourlyForBusiness(scoped, timezones.get(id)!, now, deps.email, deps.appUrl)
      const billing = await runBillingHourly(scoped, timezones.get(id)!, now, deps.email, deps.appUrl)
      if (Number(formatZoned(now, timezones.get(id)!, "H")) === PURGE_HOUR) await purgeOldMessages(scoped, now)
      if (result.daily || result.weekly || billing.pending) await flushBusiness(db, id, deps, now)
    },
  )
}

/** Cada 5 minutos: vence los turnos retenidos sin seña (antes pregunta a Mercado Pago si se pagó). */
export async function runExpireHolds(now = new Date()) {
  const ids = await forPlatform(db).businessesWithExpiredHolds(now)
  const deps = deliveryDeps()
  return forEachBusiness(ids, async (id) => {
    await expireHolds(forBusiness(db, id), deps.payments ?? null, now)
    // Aviso al cliente y ofertas a la lista de espera, enseguida.
    await flushBusiness(db, id, deps, now)
  })
}

/** Diario: tokens de WhatsApp y Mercado Pago; a los que se vencieron les llega el aviso enseguida. */
export async function runTokenHealth(now = new Date()) {
  const whatsapp = await checkWhatsAppTokens()
  const mercadopago = await checkMercadoPagoTokens(paymentDeps(), now)
  const deps = deliveryDeps()
  const broken = [...new Set([...whatsapp.expired, ...mercadopago.expired])]
  await forEachBusiness(broken, (id) => flushBusiness(db, id, deps, now))
  return {
    whatsapp: { checked: whatsapp.checked, expired: whatsapp.expired.length },
    mercadopago: { checked: mercadopago.checked, refreshed: mercadopago.refreshed, expired: mercadopago.expired.length },
  }
}
