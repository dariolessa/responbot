/*
 * Lectura de una página web para el importador del catálogo, sin efectos:
 * HTML → texto visible, links del mismo sitio, imágenes candidatas y datos
 * estructurados (JSON-LD). Es lo que lee el modelo para armar las fichas.
 */

export type PageDigest = {
  url: string
  title: string
  /** Texto visible, recortado. */
  text: string
  /** Bloques JSON-LD tal cual (muchas webs de inmobiliarias los publican). */
  jsonLd: string[]
  /** Links del mismo sitio con su texto, sin repetir. */
  links: { url: string; text: string }[]
  /** Imágenes que pueden ser fotos de publicaciones (sin íconos ni logos), absolutas. */
  images: string[]
}

const TEXT_MAX = 24_000
const JSON_LD_MAX = 12_000
const MAX_LINKS = 300
const MAX_IMAGES = 80

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  deg: "°",
  sup2: "²",
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z\d]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match
    }
    return entities[code] ?? match
  })
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)
  if (!match) return null
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim()
}

export function absoluteUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

/** Íconos, logos y adornos que no son fotos de una publicación. */
function looksDecorative(url: string): boolean {
  const lower = url.toLowerCase()
  if (/\.(svg|ico)(\?|$)/.test(lower)) return true
  if (lower.startsWith("data:")) return true
  return /(logo|icon|sprite|favicon|avatar|placeholder|blank|pixel|spinner|loading|flag|whatsapp|facebook|instagram|twitter)/.test(
    lower,
  )
}

/** Primera URL de un srcset (la de mayor ancho, si dice). */
function fromSrcset(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/))
    .filter((p) => p[0])
    .map((p) => ({ url: p[0]!, width: parseInt(p[1] ?? "0", 10) || 0 }))
  candidates.sort((a, b) => b.width - a.width)
  return candidates[0]?.url ?? null
}

export function digestPage(html: string, pageUrl: string): PageDigest {
  const base = (() => {
    const tag = /<base\s[^>]*>/i.exec(html)?.[0]
    const href = tag ? attr(tag, "href") : null
    return (href && absoluteUrl(href, pageUrl)) || pageUrl
  })()
  const host = new URL(pageUrl).host.replace(/^www\./, "")

  const jsonLd = [...html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]!.trim())
    .filter(Boolean)

  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")

  const images: string[] = []
  const seenImages = new Set<string>()
  const addImage = (src: string | null) => {
    if (!src) return
    const url = absoluteUrl(src, base)
    if (!url || seenImages.has(url) || looksDecorative(url)) return
    seenImages.add(url)
    images.push(url)
  }
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const property = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase()
    if (property === "og:image" || property === "og:image:url" || property === "twitter:image") {
      addImage(attr(tag, "content"))
    }
  }
  for (const tag of html.match(/<(img|source)\s[^>]*>/gi) ?? []) {
    addImage(
      attr(tag, "data-src") ??
        attr(tag, "data-lazy-src") ??
        attr(tag, "data-original") ??
        (attr(tag, "data-srcset") ? fromSrcset(attr(tag, "data-srcset")!) : null) ??
        (attr(tag, "srcset") ? fromSrcset(attr(tag, "srcset")!) : null) ??
        attr(tag, "src"),
    )
  }
  // Fondos con style="background-image: url(...)", comunes en tarjetas de propiedades.
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    addImage(decodeEntities(m[1]!))
  }

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")

  const links: PageDigest["links"] = []
  const seenLinks = new Set<string>()
  for (const m of body.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(` ${m[1]}`, "href")
    const url = href ? absoluteUrl(href, base) : null
    if (!url || seenLinks.has(url) || url === pageUrl) continue
    if (new URL(url).host.replace(/^www\./, "") !== host) continue
    seenLinks.add(url)
    links.push({ url, text: stripTags(m[2]!).replace(/\s+/g, " ").slice(0, 120) })
    if (links.length >= MAX_LINKS) break
  }

  const text = stripTags(body.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n$&"))

  return {
    url: pageUrl,
    title,
    text: text.slice(0, TEXT_MAX),
    jsonLd: jsonLd.join("\n").length > JSON_LD_MAX ? [jsonLd.join("\n").slice(0, JSON_LD_MAX)] : jsonLd,
    links,
    images: images.slice(0, MAX_IMAGES),
  }
}
