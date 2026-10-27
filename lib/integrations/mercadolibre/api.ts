/*
 * API oficial de MercadoLibre (https://api.mercadolibre.com) para leer las
 * publicaciones de un vendedor: con el token de la app (client_credentials)
 * se buscan las de una tienda por su apodo o id; con la cuenta del vendedor
 * conectada (OAuth con PKCE), las suyas. `fetch` es inyectable para los tests.
 */

export const ML_API = "https://api.mercadolibre.com"

export type MlOptions = { fetch?: typeof fetch }
export type MlApp = { clientId: string; clientSecret: string }

export class MercadoLibreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "MercadoLibreError"
  }

  get tokenInvalid(): boolean {
    return this.status === 401 || this.code === "invalid_grant" || this.code === "invalid_token"
  }
}

async function mlRequest<T>(
  options: MlOptions,
  method: "GET" | "POST",
  path: string,
  init: { token?: string; form?: Record<string, string> } = {},
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const headers: Record<string, string> = { Accept: "application/json" }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.form) headers["Content-Type"] = "application/x-www-form-urlencoded"
  const response = await doFetch(`${ML_API}${path}`, {
    method,
    headers,
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // No es JSON: se informa con el estado HTTP.
  }
  if (!response.ok) {
    const body = (json ?? {}) as { message?: string; error?: string }
    throw new MercadoLibreError(body.message ?? `MercadoLibre respondió ${response.status}`, response.status, body.error)
  }
  return json as T
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type MlTokens = {
  access_token: string
  refresh_token?: string
  /** Segundos (MercadoLibre da 6 horas). */
  expires_in: number
  user_id?: number
}

/** Dominio de autorización de cada país (el vendedor entra con su cuenta de ahí). */
const authHosts: Record<string, string> = {
  MLU: "auth.mercadolibre.com.uy",
  MLA: "auth.mercadolibre.com.ar",
  MLM: "auth.mercadolibre.com.mx",
  MLC: "auth.mercadolibre.cl",
  MCO: "auth.mercadolibre.com.co",
  MPE: "auth.mercadolibre.com.pe",
  MLB: "auth.mercadolivre.com.br",
}

export function authorizationUrl(
  app: Pick<MlApp, "clientId">,
  input: { siteId: string; redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(`https://${authHosts[input.siteId] ?? authHosts.MLU}/authorization`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", app.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export type MercadoLibreApi = {
  appToken(): Promise<MlTokens>
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<MlTokens>
  refreshTokens(refreshToken: string): Promise<MlTokens>
  me(token: string): Promise<MlUser>
  /** Ids de las publicaciones activas de un vendedor, buscando en el sitio (hasta `max`). */
  searchSellerItems(token: string, input: { siteId: string; sellerId?: string; nickname?: string; max: number }): Promise<{ sellerId: string | null; ids: string[] }>
  /** Ids de las publicaciones activas de la cuenta conectada (hasta `max`). */
  userItems(token: string, userId: string, max: number): Promise<string[]>
  items(token: string, ids: string[]): Promise<MlItem[]>
  description(token: string, itemId: string): Promise<string | null>
}

export type MlUser = { id: number; nickname: string; site_id?: string; permalink?: string }

export type MlAttribute = { id: string; name: string; value_name: string | null }

export type MlItem = {
  id: string
  title: string
  price: number | null
  currency_id: string | null
  permalink: string
  status?: string
  seller_id?: number
  pictures?: { secure_url?: string; url?: string }[]
  attributes?: MlAttribute[]
  location?: {
    address_line?: string
    neighborhood?: { name?: string } | null
    city?: { name?: string } | null
    state?: { name?: string } | null
  } | null
  seller_address?: { city?: { name?: string } | null; state?: { name?: string } | null } | null
}

const PAGE = 50
const MULTIGET = 20

export function mercadoLibreApi(app: MlApp, options: MlOptions = {}): MercadoLibreApi {
  return {
    appToken() {
      return mlRequest(options, "POST", "/oauth/token", {
        form: { grant_type: "client_credentials", client_id: app.clientId, client_secret: app.clientSecret },
      })
    },

    exchangeCode(input) {
      return mlRequest(options, "POST", "/oauth/token", {
        form: {
          grant_type: "authorization_code",
          client_id: app.clientId,
          client_secret: app.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        },
      })
    },

    refreshTokens(refreshToken) {
      return mlRequest(options, "POST", "/oauth/token", {
        form: {
          grant_type: "refresh_token",
          client_id: app.clientId,
          client_secret: app.clientSecret,
          refresh_token: refreshToken,
        },
      })
    },

    me(token) {
      return mlRequest(options, "GET", "/users/me", { token })
    },

    async searchSellerItems(token, input) {
      const ids: string[] = []
      let sellerId: string | null = input.sellerId ?? null
      for (let offset = 0; offset < input.max; offset += PAGE) {
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
        if (input.sellerId) params.set("seller_id", input.sellerId)
        else if (input.nickname) params.set("nickname", input.nickname)
        const page = await mlRequest<{ seller?: { id: number } | null; results: { id: string; seller?: { id: number } }[]; paging?: { total: number } }>(
          options,
          "GET",
          `/sites/${input.siteId}/search?${params}`,
          { token },
        )
        sellerId ??= page.seller?.id ? String(page.seller.id) : page.results[0]?.seller?.id ? String(page.results[0].seller.id) : null
        ids.push(...page.results.map((r) => r.id))
        if (page.results.length < PAGE || ids.length >= (page.paging?.total ?? 0)) break
      }
      return { sellerId, ids: ids.slice(0, input.max) }
    },

    async userItems(token, userId, max) {
      const ids: string[] = []
      for (let offset = 0; offset < max; offset += PAGE) {
        const page = await mlRequest<{ results: string[]; paging?: { total: number } }>(
          options,
          "GET",
          `/users/${encodeURIComponent(userId)}/items/search?status=active&limit=${PAGE}&offset=${offset}`,
          { token },
        )
        ids.push(...page.results)
        if (page.results.length < PAGE || ids.length >= (page.paging?.total ?? 0)) break
      }
      return ids.slice(0, max)
    },

    async items(token, ids) {
      const out: MlItem[] = []
      for (let i = 0; i < ids.length; i += MULTIGET) {
        const chunk = ids.slice(i, i + MULTIGET)
        const rows = await mlRequest<{ code: number; body: MlItem }[]>(
          options,
          "GET",
          `/items?ids=${chunk.map(encodeURIComponent).join(",")}`,
          { token },
        )
        for (const row of rows) if (row.code === 200 && row.body) out.push(row.body)
      }
      return out
    },

    async description(token, itemId) {
      try {
        const body = await mlRequest<{ plain_text?: string }>(options, "GET", `/items/${encodeURIComponent(itemId)}/description`, { token })
        return body.plain_text?.trim() || null
      } catch {
        return null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Links de MercadoLibre
// ---------------------------------------------------------------------------

const siteByDomain: [RegExp, string][] = [
  [/mercadolibre\.com\.uy$/, "MLU"],
  [/mercadolibre\.com\.ar$/, "MLA"],
  [/mercadolibre\.com\.mx$/, "MLM"],
  [/mercadolibre\.cl$/, "MLC"],
  [/mercadolibre\.com\.co$/, "MCO"],
  [/mercadolibre\.com\.pe$/, "MPE"],
  [/mercadolivre\.com\.br$/, "MLB"],
]

export type MlStoreRef = {
  siteId: string
  /** Apodo o nombre de la tienda ("puenterural"). */
  nickname?: string
  sellerId?: string
  /** Una publicación suelta: se busca su vendedor. */
  itemId?: string
}

/**
 * Qué tienda señala un link de MercadoLibre. Entiende:
 * - listado.mercadolibre.com.uy/pagina/puenterural/ (tienda)
 * - perfil.mercadolibre.com.uy/PUENTERURAL (perfil)
 * - listado.mercadolibre.com.uy/_CustId_123456 (listado por vendedor)
 * - …/MLU-123456789-casa-… (una publicación)
 */
export function parseStoreUrl(raw: string): MlStoreRef | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const siteId = siteByDomain.find(([re]) => re.test(host))?.[1]
  if (!siteId) return null
  const path = decodeURIComponent(url.pathname)

  const custId = /_CustId_(\d+)/i.exec(path)?.[1]
  if (custId) return { siteId, sellerId: custId }

  const pagina = /^\/pagina\/([^/]+)/i.exec(path)?.[1]
  if (pagina) return { siteId, nickname: pagina }

  if (host.startsWith("perfil.")) {
    const nick = path.split("/").filter(Boolean)[0]
    if (nick) return { siteId, nickname: nick }
  }

  const item = /\b(M[A-Z]{2})-?(\d{6,})/.exec(path)
  if (item) return { siteId, itemId: `${item[1]}${item[2]}` }

  // listado.mercadolibre.com.uy/_Tienda_puenterural (tiendas oficiales)
  const tienda = /_Tienda_([^_/]+)/i.exec(path)?.[1]
  if (tienda) return { siteId, nickname: tienda }
  return null
}
