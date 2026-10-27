import { eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import {
  MercadoLibreError,
  parseStoreUrl,
  type MercadoLibreApi,
  type MlItem,
} from "@/lib/integrations/mercadolibre/api"

import type { FoundItem } from "./extract"

/*
 * Publicaciones de una tienda de MercadoLibre con la API oficial: con la
 * cuenta del vendedor conectada se leen las suyas; si no, se buscan las de la
 * tienda del link con el token de la app. Los datos vienen estructurados, así
 * que no hace falta el modelo.
 */

export const MAX_ML_ITEMS = 150
const MAX_DESCRIPTIONS = 60
/** El token del vendedor dura 6 horas: se renueva si le queda menos que esto. */
const REFRESH_BEFORE_MS = 10 * 60_000

export class SourceError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message)
    this.name = "SourceError"
  }
}

export type MlDeps = {
  api: MercadoLibreApi
  encrypt(value: string): string
  decrypt(value: string): string
}

/** Atributos que importan en inmuebles y autos, en este orden; del resto se toman algunos más. */
const preferred = [
  "PROPERTY_TYPE",
  "BEDROOMS",
  "ROOMS",
  "FULL_BATHROOMS",
  "COVERED_AREA",
  "TOTAL_AREA",
  "PARKING_LOTS",
  "HAS_SWIMMING_POOL",
  "BRAND",
  "MODEL",
  "VEHICLE_YEAR",
  "KILOMETERS",
]
/** Datos internos que no le sirven a un cliente. */
const hidden = new Set(["OPERATION", "ITEM_CONDITION", "SELLER_SKU", "GTIN", "LISTING_TYPE", "OPERATION_SUBTYPE"])

export function mlToFound(item: MlItem, description: string | null): FoundItem {
  const attrs = (item.attributes ?? []).filter((a) => a.value_name && a.name)
  const ordered = [
    ...preferred.flatMap((id) => attrs.filter((a) => a.id === id)),
    ...attrs.filter((a) => !preferred.includes(a.id) && !hidden.has(a.id)),
  ].slice(0, 12)
  const loc = item.location
  const location =
    [loc?.neighborhood?.name, loc?.city?.name ?? item.seller_address?.city?.name, loc?.state?.name ?? item.seller_address?.state?.name]
      .filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i)
      .join(", ") || null
  return {
    title: item.title.slice(0, 200),
    description: description ? description.slice(0, 2000) : null,
    price: item.price ?? null,
    currency: item.currency_id ?? null,
    operation: attrs.find((a) => a.id === "OPERATION")?.value_name ?? null,
    location,
    attributes: ordered.map((a) => ({ label: a.name.slice(0, 40), value: a.value_name!.slice(0, 80) })),
    imageUrls: (item.pictures ?? []).flatMap((p) => p.secure_url ?? p.url ?? []).slice(0, 10),
    url: item.permalink,
  }
}

/** Token del vendedor conectado, renovado si está por vencer; null si la fuente no tiene cuenta conectada. */
async function sellerToken(scoped: ScopedDb, source: schema.CatalogSource, deps: MlDeps, now: Date): Promise<string | null> {
  if (!source.accessTokenEnc) return null
  if (source.tokenExpiresAt && source.tokenExpiresAt.getTime() - now.getTime() > REFRESH_BEFORE_MS) {
    return deps.decrypt(source.accessTokenEnc)
  }
  if (!source.refreshTokenEnc) return deps.decrypt(source.accessTokenEnc)
  try {
    const tokens = await deps.api.refreshTokens(deps.decrypt(source.refreshTokenEnc))
    await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), {
      accessTokenEnc: deps.encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? deps.encrypt(tokens.refresh_token) : source.refreshTokenEnc,
      tokenExpiresAt: new Date(now.getTime() + tokens.expires_in * 1000),
    })
    return tokens.access_token
  } catch (error) {
    if (error instanceof MercadoLibreError && (error.tokenInvalid || error.status === 400)) {
      await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), {
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
      })
      throw new SourceError("token de MercadoLibre revocado", "MercadoLibre se desconectó. Volvé a conectar la cuenta.")
    }
    throw error
  }
}

export async function crawlMercadoLibre(
  scoped: ScopedDb,
  source: schema.CatalogSource,
  deps: MlDeps,
  now: Date,
): Promise<FoundItem[]> {
  let token = await sellerToken(scoped, source, deps, now)
  let ids: string[]
  if (token && source.externalId) {
    ids = await deps.api.userItems(token, source.externalId, MAX_ML_ITEMS)
  } else {
    const ref = parseStoreUrl(source.url)
    if (!ref) {
      throw new SourceError(
        `link de MercadoLibre sin tienda: ${source.url}`,
        "No reconocemos la tienda en ese link. Pegá el link de tu página de vendedor (por ejemplo listado.mercadolibre.com.uy/pagina/tutienda) o conectá la cuenta.",
      )
    }
    token = (await deps.api.appToken()).access_token
    let sellerId = source.externalId ?? ref.sellerId
    if (!sellerId && ref.itemId) {
      const [item] = await deps.api.items(token, [ref.itemId])
      if (item?.seller_id) sellerId = String(item.seller_id)
    }
    let result: Awaited<ReturnType<MercadoLibreApi["searchSellerItems"]>>
    try {
      result = await deps.api.searchSellerItems(token, {
        siteId: ref.siteId,
        sellerId: sellerId ?? undefined,
        nickname: sellerId ? undefined : ref.nickname,
        max: MAX_ML_ITEMS,
      })
    } catch (error) {
      if (error instanceof MercadoLibreError && (error.status === 403 || error.status === 401)) {
        throw new SourceError(
          `búsqueda pública rechazada (${error.status})`,
          "MercadoLibre no deja ver esa tienda desde afuera. Conectá la cuenta de MercadoLibre del negocio.",
        )
      }
      throw error
    }
    ids = result.ids
    if (result.sellerId && result.sellerId !== source.externalId) {
      await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), { externalId: result.sellerId })
    }
  }
  if (ids.length === 0) return []

  const items = (await deps.api.items(token, ids)).filter((i) => !i.status || i.status === "active")
  const withDescription = new Set(items.slice(0, MAX_DESCRIPTIONS).map((i) => i.id))
  const found: FoundItem[] = []
  for (const item of items) {
    const description = withDescription.has(item.id) ? await deps.api.description(token, item.id) : null
    found.push(mlToFound(item, description))
  }
  return found
}
