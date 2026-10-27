import { and, eq, notInArray } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { StructuredModel } from "@/lib/integrations/anthropic/types"
import { PageFetchError, type PageFetcher } from "@/lib/integrations/web/fetch"

import { extractPage, type FoundItem } from "./extract"
import { crawlInstagram, type IgDeps } from "./instagram"
import { crawlMercadoLibre, SourceError, type MlDeps } from "./mercadolibre"
import { digestPage } from "./page"

/*
 * Importación de una fuente del catálogo (docs/CATALOGO.md). Para una web:
 *
 * 1. Lee la página que cargó el negocio y le pide al modelo las publicaciones
 *    que se ven y los links a cada ficha.
 * 2. Si es un listado, abre cada ficha (hasta MAX_DETAIL_PAGES) y saca sus
 *    datos completos y fotos.
 * 3. Guarda: crea las nuevas, actualiza las que ya estaban (salvo las que el
 *    dueño editó a mano) y marca como no disponibles las que ya no aparecen.
 *
 * MercadoLibre e Instagram no se leen como web: van por sus APIs oficiales
 * (lib/listings/mercadolibre.ts e instagram.ts, ver docs/CATALOGO.md).
 */

export const MAX_DETAIL_PAGES = 30
const CONCURRENCY = 4
/** Una importación "corriendo" hace más que esto se da por muerta. */
const STALE_RUN_MS = 15 * 60_000

export type ImportDeps = {
  fetchPage: PageFetcher
  model: StructuredModel
  /** null si la plataforma no configuró la app de MercadoLibre. */
  mercadolibre?: MlDeps | null
  /** null si la plataforma no configuró la app de Instagram. */
  instagram?: Omit<IgDeps, "model"> | null
  now?: () => Date
}

export type ImportResult =
  | { ok: true; found: number; created: number; updated: number; hidden: number }
  | { ok: false; error: string }

type Found = FoundItem

/** Qué tipo de fuente es una URL; las redes y marketplaces no se pueden leer como web. */
export function sourceKindFor(url: string): schema.CatalogSource["kind"] {
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram"
  if (/(^|\.)mercadoli(b|v)re\.com(\.[a-z]{2})?$/.test(host) || /(^|\.)mercadolibre\.[a-z.]+$/.test(host)) {
    return "mercadolibre"
  }
  return "web"
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\d]+/g, "-")
    .replace(/^-|-$/g, "")
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const i = next++
      out[i] = await fn(list[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}

/** Lee la web y devuelve las publicaciones encontradas, sin tocar la base. */
export async function crawlWebSource(url: string, deps: ImportDeps): Promise<Found[]> {
  const start = await deps.fetchPage(url)
  const listing = await extractPage(deps.model, digestPage(start.html, start.url), "listing")

  const links = [...new Set([...listing.itemLinks, ...listing.items.flatMap((i) => (i.url ? [i.url] : []))])]
    .filter((link) => link !== start.url)
    .slice(0, MAX_DETAIL_PAGES)
  if (links.length === 0) return listing.items

  const fromListing = new Map(listing.items.filter((i) => i.url).map((i) => [i.url!, i]))
  const details = await mapLimit(links, CONCURRENCY, async (link) => {
    try {
      const page = await deps.fetchPage(link)
      const [item] = (await extractPage(deps.model, digestPage(page.html, page.url), "detail")).items
      return item ? { ...item, url: link } : null
    } catch (error) {
      console.error("[catalogo] no se pudo leer la ficha", link, error instanceof Error ? error.message : error)
      return null
    }
  })

  const merged: Found[] = []
  for (const [i, link] of links.entries()) {
    const detail = details[i]
    const summary = fromListing.get(link)
    if (!detail && !summary) continue
    if (!detail) {
      merged.push(summary!)
      continue
    }
    merged.push({
      ...detail,
      price: detail.price ?? summary?.price ?? null,
      currency: detail.currency ?? summary?.currency ?? null,
      location: detail.location ?? summary?.location ?? null,
      operation: detail.operation ?? summary?.operation ?? null,
      imageUrls: detail.imageUrls.length ? detail.imageUrls : (summary?.imageUrls ?? []),
    })
  }
  // Publicaciones del listado sin ficha propia.
  for (const item of listing.items) if (!item.url) merged.push(item)
  return merged
}

function toValues(item: Found, currency: string) {
  return {
    title: item.title,
    description: item.description,
    price: item.price === null ? null : Math.round(item.price * 100),
    currency: item.price === null ? null : (item.currency ?? currency),
    operation: item.operation,
    location: item.location,
    attributes: item.attributes,
    imageUrls: item.imageUrls.slice(0, 10),
    url: item.url,
  }
}

export async function importSource(scoped: ScopedDb, sourceId: string, deps: ImportDeps): Promise<ImportResult> {
  const now = (deps.now ?? (() => new Date()))()
  const source = await scoped.catalogSources.findById(sourceId)
  if (!source) return { ok: false, error: "Esa fuente ya no existe." }
  if (source.status === "running" && now.getTime() - source.updatedAt.getTime() < STALE_RUN_MS) {
    return { ok: false, error: "Ya se está importando. Esperá unos minutos." }
  }
  const business = await scoped.business()
  if (!business) return { ok: false, error: "No existe el negocio." }

  const fail = async (error: string): Promise<ImportResult> => {
    await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), {
      status: "error",
      lastError: error,
      lastImportedAt: now,
    })
    return { ok: false, error }
  }

  await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), { status: "running", lastError: null })

  let found: Found[]
  try {
    if (source.kind === "mercadolibre") {
      if (!deps.mercadolibre) return fail("La lectura de MercadoLibre todavía no está habilitada.")
      found = await crawlMercadoLibre(scoped, source, deps.mercadolibre, now)
    } else if (source.kind === "instagram") {
      if (!deps.instagram) return fail("La lectura de Instagram todavía no está habilitada.")
      found = await crawlInstagram(scoped, source, { ...deps.instagram, model: deps.model }, now)
    } else {
      found = await crawlWebSource(source.url, deps)
    }
  } catch (error) {
    console.error("[catalogo] falló la importación", source.url, error)
    return fail(
      error instanceof PageFetchError || error instanceof SourceError
        ? error.userMessage
        : "No pudimos leer las publicaciones. Probá de nuevo más tarde.",
    )
  }
  if (found.length === 0) {
    return fail(
      source.kind === "web"
        ? "No encontramos publicaciones en esa página. Probá con la página donde se ve el listado o con la de una publicación."
        : "No encontramos publicaciones disponibles en esa cuenta.",
    )
  }

  // Una clave por publicación: su link, o el título si no tiene ficha propia.
  const byKey = new Map<string, Found>()
  for (const item of found) byKey.set(item.url ?? `${source.url}#${normalizeKey(item.title)}`, item)

  let created = 0
  let updated = 0
  const hidden = await scoped.transaction(async (tx) => {
    const existing = await tx.catalogItems.findMany({ where: eq(schema.catalogItems.sourceId, source.id) })
    const byExisting = new Map(existing.map((row) => [row.externalKey, row]))
    for (const [key, item] of byKey) {
      const row = byExisting.get(key)
      if (!row) {
        await tx.catalogItems.insert({
          ...toValues(item, business.currency),
          sourceId: source.id,
          externalKey: key,
          available: true,
          lastSeenAt: now,
        })
        created++
      } else if (row.editedManually) {
        await tx.catalogItems.update(eq(schema.catalogItems.id, row.id), { lastSeenAt: now })
      } else {
        await tx.catalogItems.update(eq(schema.catalogItems.id, row.id), {
          ...toValues(item, business.currency),
          available: true,
          lastSeenAt: now,
        })
        updated++
      }
    }
    // Lo que ya no aparece en la web se dejó de ofrecer (vendido, alquilado, pausado).
    const gone = await tx.catalogItems.update(
      and(
        eq(schema.catalogItems.sourceId, source.id),
        eq(schema.catalogItems.available, true),
        notInArray(schema.catalogItems.externalKey, [...byKey.keys()]),
      ),
      { available: false },
    )
    await tx.catalogSources.update(eq(schema.catalogSources.id, source.id), {
      status: "ok",
      lastError: null,
      lastImportedAt: now,
      itemCount: byKey.size,
    })
    return gone.length
  })

  return { ok: true, found: byKey.size, created, updated, hidden }
}
