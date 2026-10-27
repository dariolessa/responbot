import "server-only"

import { after } from "next/server"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { anthropicStructured, isAnthropicConfigured } from "@/lib/integrations/anthropic/client"
import { fetchPublicPage } from "@/lib/integrations/web/fetch"

import { importSource, type ImportDeps } from "./import"

/*
 * Armado real del importador (web + Claude) y lo que lo dispara: el botón
 * del panel (en segundo plano, con after) y el cron diario.
 */

export function importDeps(): ImportDeps | null {
  if (!isAnthropicConfigured()) return null
  return { fetchPage: fetchPublicPage, model: anthropicStructured() }
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
