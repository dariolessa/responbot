/*
 * API de Instagram con "Iniciar sesión con Instagram" (cuentas profesionales):
 * el negocio autoriza la app, se guarda un token de 60 días que se renueva
 * solo, y se leen sus publicaciones (foto y texto). `fetch` es inyectable.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */

export const IG_AUTHORIZE = "https://www.instagram.com/oauth/authorize"
const IG_OAUTH = "https://api.instagram.com/oauth/access_token"
const IG_GRAPH = "https://graph.instagram.com"
const IG_VERSION = "v23.0"
export const IG_SCOPE = "instagram_business_basic"

export type IgOptions = { fetch?: typeof fetch }
export type IgApp = { appId: string; appSecret: string }

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message)
    this.name = "InstagramError"
  }

  get tokenInvalid(): boolean {
    return this.status === 401 || this.code === 190
  }
}

async function igRequest<T>(options: IgOptions, url: string, init: RequestInit = {}): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // No es JSON.
  }
  if (!response.ok) {
    const error = ((json ?? {}) as { error?: { message?: string; code?: number }; error_message?: string })
    throw new InstagramError(
      error.error?.message ?? error.error_message ?? `Instagram respondió ${response.status}`,
      response.status,
      error.error?.code,
    )
  }
  return json as T
}

export function authorizationUrl(app: Pick<IgApp, "appId">, input: { redirectUri: string; state: string }): string {
  const url = new URL(IG_AUTHORIZE)
  url.searchParams.set("client_id", app.appId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", IG_SCOPE)
  url.searchParams.set("state", input.state)
  return url.toString()
}

export type IgLongToken = { access_token: string; expires_in: number }

export type IgMedia = {
  id: string
  caption?: string
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_url?: string
  thumbnail_url?: string
  permalink: string
  timestamp?: string
  children?: { data: { media_type: string; media_url?: string; thumbnail_url?: string }[] }
}

export type InstagramApi = {
  /** Código → token largo (60 días) y la cuenta. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<IgLongToken & { userId: string; username: string }>
  refresh(token: string): Promise<IgLongToken>
  /** Publicaciones más recientes (hasta `max`). */
  media(token: string, max: number): Promise<IgMedia[]>
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}"

export function instagramApi(app: IgApp, options: IgOptions = {}): InstagramApi {
  return {
    async exchangeCode({ code, redirectUri }) {
      const short = await igRequest<{ access_token: string; user_id: number | string }>(options, IG_OAUTH, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }).toString(),
      })
      const long = await igRequest<IgLongToken>(
        options,
        `${IG_GRAPH}/access_token?${new URLSearchParams({
          grant_type: "ig_exchange_token",
          client_secret: app.appSecret,
          access_token: short.access_token,
        })}`,
      )
      const me = await igRequest<{ user_id?: string; id?: string; username: string }>(
        options,
        `${IG_GRAPH}/${IG_VERSION}/me?${new URLSearchParams({ fields: "user_id,username", access_token: long.access_token })}`,
      )
      return { ...long, userId: String(me.user_id ?? me.id ?? short.user_id), username: me.username }
    },

    refresh(token) {
      return igRequest(
        options,
        `${IG_GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`,
      )
    },

    async media(token, max) {
      const out: IgMedia[] = []
      let next: string | null =
        `${IG_GRAPH}/${IG_VERSION}/me/media?${new URLSearchParams({ fields: MEDIA_FIELDS, limit: "50", access_token: token })}`
      while (next && out.length < max) {
        const page: { data: IgMedia[]; paging?: { next?: string } } = await igRequest(options, next)
        out.push(...page.data)
        next = page.paging?.next ?? null
      }
      return out.slice(0, max)
    },
  }
}
