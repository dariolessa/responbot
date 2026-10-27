import "server-only"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
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

/** Cada hora: resumen diario y semanal a las 8:00 locales, y correos de alta incompleta. */
export async function runDailySummary(now = new Date()) {
  const businesses = await forPlatform(db).businessesForCron()
  const deps = deliveryDeps()
  const timezones = new Map(businesses.map((b) => [b.id, b.timezone]))
  return forEachBusiness(
    businesses.map((b) => b.id),
    async (id) => {
      const result = await runHourlyForBusiness(forBusiness(db, id), timezones.get(id)!, now, deps.email, deps.appUrl)
      if (result.daily || result.weekly) await flushBusiness(db, id, deps, now)
    },
  )
}

/** Diario: tokens de WhatsApp; a los que se vencieron les llega el aviso enseguida. */
export async function runTokenHealth(now = new Date()) {
  const whatsapp = await checkWhatsAppTokens()
  const deps = deliveryDeps()
  await forEachBusiness(whatsapp.expired, (id) => flushBusiness(db, id, deps, now))
  return { whatsapp: { checked: whatsapp.checked, expired: whatsapp.expired.length } }
}
