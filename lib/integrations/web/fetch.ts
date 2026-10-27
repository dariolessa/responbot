import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/*
 * Descarga de páginas públicas para el importador del catálogo. Como la URL
 * la escribe un negocio, se cuida que no apunte a la red interna (SSRF): solo
 * http/https en puertos estándar, ninguna IP privada, y cada redirección se
 * vuelve a revisar. Tamaño y tiempo acotados.
 */

export class PageFetchError extends Error {
  constructor(
    message: string,
    /** Para mostrarle al dueño, sin jerga. */
    readonly userMessage: string,
  ) {
    super(message)
    this.name = "PageFetchError"
  }
}

export type FetchedPage = { url: string; html: string }
export type PageFetcher = (url: string) => Promise<FetchedPage>

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 4
const USER_AGENT = "Mozilla/5.0 (compatible; ResponbotCatalog/1.0; +https://responbot-phi.vercel.app)"

/** IPv4 o IPv6 de la red interna, loopback, link-local o reservadas. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const lower = address.toLowerCase()
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7))
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("ff")
  )
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PageFetchError(`URL inválida: ${raw}`, "La dirección no es válida.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageFetchError(`protocolo no permitido: ${url.protocol}`, "La dirección tiene que empezar con https://.")
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new PageFetchError(`puerto no permitido: ${url.port}`, "No podemos leer direcciones con ese puerto.")
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PageFetchError(`host interno: ${host}`, "Esa dirección no es una página pública.")
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (addresses.length === 0) {
    throw new PageFetchError(`no resuelve: ${host}`, "No encontramos esa página. Revisá que la dirección esté bien escrita.")
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new PageFetchError(`IP privada: ${host}`, "Esa dirección no es una página pública.")
  }
  return url
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const charset = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? "utf-8"
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset)
  } catch {
    decoder = new TextDecoder("utf-8")
  }
  return decoder.decode(Buffer.concat(chunks))
}

export const fetchPublicPage: PageFetcher = async (raw) => {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current)
    let response: Response
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "es" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new PageFetchError(
        `no se pudo descargar ${url}: ${error instanceof Error ? error.message : error}`,
        "La página no respondió. Probá de nuevo más tarde.",
      )
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = new URL(response.headers.get("location")!, url).toString()
      continue
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new PageFetchError(
        `bloqueado (${response.status}) ${url}`,
        "La página no nos deja leerla (pide iniciar sesión o bloquea lectores automáticos).",
      )
    }
    if (!response.ok) {
      throw new PageFetchError(`HTTP ${response.status} ${url}`, `La página respondió con un error (${response.status}).`)
    }
    const type = response.headers.get("content-type") ?? ""
    if (type && !/html|xml/i.test(type)) {
      throw new PageFetchError(`no es HTML (${type}) ${url}`, "Esa dirección no es una página web.")
    }
    return { url: url.toString(), html: await readLimited(response) }
  }
  throw new PageFetchError(`demasiadas redirecciones ${raw}`, "La página redirige demasiadas veces.")
}
