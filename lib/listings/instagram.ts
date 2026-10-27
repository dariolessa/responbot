import { eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { StructuredModel } from "@/lib/integrations/anthropic/types"
import { InstagramError, type IgMedia, type InstagramApi } from "@/lib/integrations/instagram/api"

import { extractPage, type FoundItem } from "./extract"
import { SourceError } from "./mercadolibre"
import type { PageDigest } from "./page"

/*
 * Publicaciones de Instagram de la cuenta conectada: se leen las últimas con
 * la API oficial y el modelo arma una ficha por cada una que ofrece algo
 * (las fotos salen de la publicación, el texto de su descripción).
 */

export const MAX_IG_POSTS = 60
const BATCH = 15
/** El token largo dura 60 días; se renueva cuando le quedan menos de 10. */
const REFRESH_BEFORE_MS = 10 * 86_400_000

export type IgDeps = {
  api: InstagramApi
  model: StructuredModel
  encrypt(value: string): string
  decrypt(value: string): string
}

function photosOf(media: IgMedia): string[] {
  if (media.media_type === "CAROUSEL_ALBUM") {
    return (media.children?.data ?? []).flatMap((c) => (c.media_type === "VIDEO" ? (c.thumbnail_url ?? []) : (c.media_url ?? [])))
  }
  return media.media_type === "VIDEO" ? (media.thumbnail_url ? [media.thumbnail_url] : []) : media.media_url ? [media.media_url] : []
}

/** Un lote de publicaciones como si fuera una página, para el mismo extractor de la web. */
export function postsDigest(username: string, posts: IgMedia[]): PageDigest {
  const images: string[] = []
  const blocks = posts.map((post, n) => {
    const indexes = photosOf(post).slice(0, 10).map((url) => images.push(url) - 1)
    return `## Publicación ${n + 1}\nLink: ${post.permalink}\nImágenes: ${indexes.join(", ") || "ninguna"}\nTexto: ${(post.caption ?? "").trim() || "(sin texto)"}`
  })
  return {
    url: `https://www.instagram.com/${username}/`,
    title: `Instagram de @${username}`,
    text: blocks.join("\n\n"),
    jsonLd: [],
    links: posts.map((p) => ({ url: p.permalink, text: (p.caption ?? "").slice(0, 80) })),
    images,
  }
}

async function igToken(scoped: ScopedDb, source: schema.CatalogSource, deps: IgDeps, now: Date): Promise<string> {
  if (!source.accessTokenEnc) {
    throw new SourceError("instagram sin token", "Conectá la cuenta de Instagram del negocio para leer sus publicaciones.")
  }
  const token = deps.decrypt(source.accessTokenEnc)
  if (source.tokenExpiresAt && source.tokenExpiresAt.getTime() - now.getTime() > REFRESH_BEFORE_MS) return token
  try {
    const fresh = await deps.api.refresh(token)
    await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), {
      accessTokenEnc: deps.encrypt(fresh.access_token),
      tokenExpiresAt: new Date(now.getTime() + fresh.expires_in * 1000),
    })
    return fresh.access_token
  } catch (error) {
    if (error instanceof InstagramError && error.tokenInvalid) {
      await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), { accessTokenEnc: null, tokenExpiresAt: null })
      throw new SourceError("token de Instagram revocado", "Instagram se desconectó. Volvé a conectar la cuenta.")
    }
    // Error pasajero: si no venció, se usa el que hay.
    if (!source.tokenExpiresAt || source.tokenExpiresAt > now) return token
    throw error
  }
}

export async function crawlInstagram(
  scoped: ScopedDb,
  source: schema.CatalogSource,
  deps: IgDeps,
  now: Date,
): Promise<FoundItem[]> {
  const token = await igToken(scoped, source, deps, now)
  let posts: IgMedia[]
  try {
    posts = await deps.api.media(token, MAX_IG_POSTS)
  } catch (error) {
    if (error instanceof InstagramError && error.tokenInvalid) {
      await scoped.catalogSources.update(eq(schema.catalogSources.id, source.id), { accessTokenEnc: null, tokenExpiresAt: null })
      throw new SourceError("token de Instagram revocado", "Instagram se desconectó. Volvé a conectar la cuenta.")
    }
    throw error
  }
  const username = source.accountName?.replace(/^@/, "") ?? "negocio"
  const found: FoundItem[] = []
  for (let i = 0; i < posts.length; i += BATCH) {
    const { items } = await extractPage(deps.model, postsDigest(username, posts.slice(i, i + BATCH)), "social")
    found.push(...items.filter((item) => item.url))
  }
  return found
}
