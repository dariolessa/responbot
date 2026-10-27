import { and, desc, eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatMoney } from "@/lib/money"

/*
 * El catálogo tal como lo usa el bot: búsqueda simple por palabras y filtros
 * de precio, y el texto de cada ficha que se manda por WhatsApp con su foto.
 */

/** Tope de fichas que se leen para buscar; un catálogo de inmobiliaria chica entra holgado. */
const SEARCH_POOL = 500

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/**
 * Precio de una ficha. A diferencia de los servicios, acá conviven monedas
 * (casas en dólares, alquileres en pesos): el dólar se escribe "US$".
 */
export function priceLabel(item: Pick<schema.CatalogItem, "price" | "currency">): string {
  if (item.price === null || !item.currency) return "Precio a consultar"
  if (item.price % 100 !== 0) return formatMoney(item.price, item.currency)
  try {
    return new Intl.NumberFormat("es-UY", {
      style: "currency",
      currency: item.currency,
      currencyDisplay: "symbol",
      maximumFractionDigits: 0,
    }).format(item.price / 100)
  } catch {
    return formatMoney(item.price, item.currency)
  }
}

export type CatalogSearch = {
  query?: string
  /** En centésimos, en `currency`. */
  maxPrice?: number | null
  minPrice?: number | null
  currency?: string | null
  limit?: number
}

/** Palabras que no ayudan a encontrar (artículos, "busco", "quiero"…). */
const stopWords = new Set(
  "una uno unos unas los las del con por para que como busco buscando quiero queria necesito tenes tienen hay algo alguna alguno cerca zona barrio".split(
    " ",
  ),
)

function scoreOf(item: schema.CatalogItem, terms: string[]): number {
  if (terms.length === 0) return 1
  const title = normalizeText(item.title)
  const location = normalizeText(item.location ?? "")
  const rest = normalizeText(
    [item.operation, item.description, ...item.attributes.map((a) => `${a.label} ${a.value}`)].join(" "),
  )
  let score = 0
  for (const term of terms) {
    // Sin la "s" final, así "casas" encuentra "casa" y "dormitorios" encuentra "dormitorio".
    const stem = term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term
    if (title.includes(stem)) score += 3
    if (location.includes(stem)) score += 3
    if (rest.includes(stem)) score += 1
  }
  return score
}

/** Fichas disponibles que mejor coinciden, primero las de más puntaje y después las más nuevas. */
export async function searchCatalog(scoped: ScopedDb, search: CatalogSearch) {
  const pool = await scoped.catalogItems.findMany({
    where: eq(schema.catalogItems.available, true),
    orderBy: desc(schema.catalogItems.createdAt),
    limit: SEARCH_POOL,
  })
  const terms = normalizeText(search.query ?? "")
    .split(/[^a-z\d]+/)
    .filter((t) => t.length >= 3 && !stopWords.has(t))

  const matches = pool
    .filter((item) => {
      const byPrice = search.maxPrice != null || search.minPrice != null
      // Con tope de precio, una ficha en otra moneda no se puede comparar: queda afuera.
      if (byPrice && item.price !== null && search.currency && item.currency !== search.currency) return false
      if (search.maxPrice != null && item.price !== null && item.price > search.maxPrice) return false
      if (search.minPrice != null && item.price !== null && item.price < search.minPrice) return false
      return true
    })
    .map((item) => ({ item, score: scoreOf(item, terms) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)

  return { total: pool.length, matches: matches.slice(0, search.limit ?? 8).map((m) => m.item) }
}

const CAPTION_MAX = 1024

/** Texto de la ficha que acompaña la foto en WhatsApp. */
export function catalogCaption(item: schema.CatalogItem): string {
  const header = [item.operation, priceLabel(item)].filter(Boolean).join(" · ")
  const attributes = item.attributes
    .slice(0, 6)
    .map((a) => `${a.label}: ${a.value}`)
    .join(" · ")
  const description = item.description ? item.description.replace(/\s+/g, " ").trim() : ""
  const fixed = [`*${item.title}*`, header, item.location ? `📍 ${item.location}` : "", attributes]
    .filter(Boolean)
    .join("\n")
  const link = item.url ? `\n\n${item.url}` : ""
  const room = CAPTION_MAX - fixed.length - link.length - 2
  const short = description && room > 40 ? `\n\n${description.length > room ? `${description.slice(0, room - 1)}…` : description}` : ""
  return `${fixed}${short}${link}`.slice(0, CAPTION_MAX)
}

/** Las fichas pedidas por id, en ese orden, solo si están disponibles. */
export async function availableItems(scoped: ScopedDb, ids: string[]): Promise<schema.CatalogItem[]> {
  const rows = await Promise.all(
    ids.map((id) => scoped.catalogItems.findFirst(and(eq(schema.catalogItems.id, id), eq(schema.catalogItems.available, true)))),
  )
  return rows.filter((r): r is schema.CatalogItem => Boolean(r))
}
