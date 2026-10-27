import "server-only"

import { after } from "next/server"

import { publicAppUrl } from "@/lib/app-url"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { anthropicStructured, isAnthropicConfigured } from "@/lib/integrations/anthropic/client"
import { instagramApi, type IgApp } from "@/lib/integrations/instagram/api"
import { mercadoLibreApi, type MlApp } from "@/lib/integrations/mercadolibre/api"
import { fetchPublicPage } from "@/lib/integrations/web/fetch"

import { importSource, type ImportDeps } from "./import"

/*
 * Armado real del importador (web + Claude) y lo que lo dispara: el botón
 * del panel (en segundo plano, con after) y el cron diario.
 */

const crypto = {
  encrypt: (value: string) => encrypt(value, env.ENCRYPTION_KEY),
  decrypt: (value: string) => decrypt(value, env.ENCRYPTION_KEY),
}

export function mlApp(): MlApp | null {
  return env.ML_CLIENT_ID && env.ML_CLIENT_SECRET ? { clientId: env.ML_CLIENT_ID, clientSecret: env.ML_CLIENT_SECRET } : null
}

export function igApp(): IgApp | null {
  return env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET
    ? { appId: env.INSTAGRAM_APP_ID, appSecret: env.INSTAGRAM_APP_SECRET }
    : null
}

export const ML_CALLBACK_PATH = "/api/integrations/mercadolibre/callback"
export const IG_CALLBACK_PATH = "/api/integrations/instagram/callback"

export function callbackUri(path: string): string {
  return `${publicAppUrl()}${path}`
}

export function catalogCrypto() {
  return crypto
}

export function importDeps(): ImportDeps | null {
  if (!isAnthropicConfigured()) return null
  const ml = mlApp()
  const ig = igApp()
  return {
    fetchPage: fetchPublicPage,
    model: anthropicStructured(),
    mercadolibre: ml ? { api: mercadoLibreApi(ml), ...crypto } : null,
    instagram: ig ? { api: instagramApi(ig), ...crypto } : null,
  }
}

/** Importa después de responder; el panel muestra "Importando…" y se refresca solo. */
export function importSoon(businessId: string, sourceId: string) {
  after(async () => {
    const deps = importDeps()
    if (!deps) return
    try {
      await importSource(forBusiness(db, businessId), sourceId, deps)
    } catch (error) {
      console.error("[catalogo] falló la importación en segundo plano", sourceId, error)
    }
  })
}

/** Cuántas fuentes se reimportan por corrida (cada una puede leer hasta 31 páginas). */
const PER_RUN = 6

/** Cron diario: vuelve a leer las fuentes que no se importan hace más de 20 horas. */
export async function reimportDueSources(now = new Date()) {
  const deps = importDeps()
  if (!deps) return { skipped: "falta ANTHROPIC_API_KEY" }
  const due = await forPlatform(db).catalogSourcesDue(new Date(now.getTime() - 20 * 3_600_000), PER_RUN)
  const results: { sourceId: string; ok: boolean }[] = []
  for (const source of due) {
    try {
      const result = await importSource(forBusiness(db, source.businessId), source.id, deps)
      results.push({ sourceId: source.id, ok: result.ok })
    } catch (error) {
      console.error("[catalogo] falló la reimportación", source.id, error)
      results.push({ sourceId: source.id, ok: false })
    }
  }
  return { checked: results.length, results }
}
