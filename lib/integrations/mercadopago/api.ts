/*
 * API oficial de Mercado Pago (https://api.mercadopago.com): OAuth de cada
 * negocio, preferencias de Checkout Pro, consulta de pagos y devoluciones.
 * Todas las llamadas de pagos usan el token del negocio (el dinero va directo
 * a su cuenta). `fetch` es inyectable para simular a Mercado Pago en tests.
 */

export const MP_API = "https://api.mercadopago.com"
export const MP_AUTH = "https://auth.mercadopago.com/authorization"

export type MpOptions = { fetch?: typeof fetch }

/** Error de la API con el estado HTTP; 401 = el token ya no sirve. */
export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "MercadoPagoError"
  }

  get tokenInvalid(): boolean {
    return this.status === 401 || this.code === "invalid_grant" || this.code === "invalid_token"
  }
}

async function mpRequest<T>(
  options: MpOptions,
  method: "GET" | "POST" | "PUT",
  path: string,
  init: { token?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const headers: Record<string, string> = { Accept: "application/json" }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.body) headers["Content-Type"] = "application/json"
  if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey
  const response = await doFetch(`${MP_API}${path}`, {
    method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
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
    throw new MercadoPagoError(body.message ?? `Mercado Pago respondió ${response.status}`, response.status, body.error)
  }
  return json as T
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type MpApp = { clientId: string; clientSecret: string }

export type MpTokens = {
  access_token: string
  refresh_token: string
  /** Segundos (Mercado Pago da 180 días). */
  expires_in: number
  user_id: number | string
  live_mode?: boolean
  public_key?: string
}

/** URL para que el dueño autorice la app en Mercado Pago (con PKCE). */
export function authorizationUrl(app: Pick<MpApp, "clientId">, input: { redirectUri: string; state: string; codeChallenge: string }) {
  const url = new URL(MP_AUTH)
  url.searchParams.set("client_id", app.clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("platform_id", "mp")
  url.searchParams.set("state", input.state)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export function exchangeCode(
  app: MpApp,
  input: { code: string; redirectUri: string; codeVerifier: string },
  options: MpOptions = {},
): Promise<MpTokens> {
  return mpRequest(options, "POST", "/oauth/token", {
    body: {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
  })
}

export function refreshTokens(app: MpApp, refreshToken: string, options: MpOptions = {}): Promise<MpTokens> {
  return mpRequest(options, "POST", "/oauth/token", {
    body: {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  })
}

/** Datos visibles de la cuenta conectada (email o apodo). */
export async function getMe(token: string, options: MpOptions = {}): Promise<{ id: number; email?: string; nickname?: string }> {
  return mpRequest(options, "GET", "/users/me", { token })
}

// ---------------------------------------------------------------------------
// Checkout Pro, pagos y devoluciones
// ---------------------------------------------------------------------------

export type PreferenceInput = {
  bookingId: string
  title: string
  /** Centésimos. */
  amount: number
  currency: string
  notificationUrl: string
  /** Hasta cuándo se puede pagar: el vencimiento de la retención. */
  expiresAt: Date
  backUrl?: string
}

export type Preference = { id: string; init_point: string; sandbox_init_point?: string }

export function preferenceBody(input: PreferenceInput): Record<string, unknown> {
  return {
    items: [
      {
        id: input.bookingId,
        title: input.title.slice(0, 250),
        quantity: 1,
        currency_id: input.currency,
        unit_price: input.amount / 100,
      },
    ],
    external_reference: input.bookingId,
    notification_url: input.notificationUrl,
    expires: true,
    expiration_date_from: new Date(input.expiresAt.getTime() - 24 * 3_600_000).toISOString(),
    expiration_date_to: input.expiresAt.toISOString(),
    // Medios en efectivo: vencen con la retención (si no, el pago llegaría días después).
    date_of_expiration: input.expiresAt.toISOString(),
    binary_mode: true,
    ...(input.backUrl
      ? { back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl } }
      : {}),
  }
}

export function createPreference(token: string, input: PreferenceInput, options: MpOptions = {}): Promise<Preference> {
  return mpRequest(options, "POST", "/checkout/preferences", {
    token,
    body: preferenceBody(input),
    idempotencyKey: `pref-${input.bookingId}-${input.expiresAt.getTime()}`,
  })
}

export type MpPayment = {
  id: number | string
  status: string
  status_detail?: string
  external_reference?: string | null
  transaction_amount: number
  transaction_amount_refunded?: number
  currency_id: string
  date_approved?: string | null
}

export function getPayment(token: string, paymentId: string, options: MpOptions = {}): Promise<MpPayment> {
  return mpRequest(options, "GET", `/v1/payments/${encodeURIComponent(paymentId)}`, { token })
}

/** Pagos de un turno (por external_reference), por si el webhook no llegó. */
export async function searchPayments(token: string, bookingId: string, options: MpOptions = {}): Promise<MpPayment[]> {
  const result = await mpRequest<{ results?: MpPayment[] }>(
    options,
    "GET",
    `/v1/payments/search?external_reference=${encodeURIComponent(bookingId)}&sort=date_created&criteria=desc`,
    { token },
  )
  return result.results ?? []
}

/** Devolución total (sin monto) o parcial (en centésimos). */
export function refundPayment(
  token: string,
  paymentId: string,
  amount: number | null,
  options: MpOptions = {},
): Promise<{ id: number; amount: number; status: string }> {
  return mpRequest(options, "POST", `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
    token,
    body: amount === null ? {} : { amount: amount / 100 },
    idempotencyKey: `refund-${paymentId}`,
  })
}

/** Lo que usa la app; los tests pasan una simulación. */
export type MercadoPagoApi = {
  createPreference(token: string, input: PreferenceInput): Promise<Preference>
  getPayment(token: string, paymentId: string): Promise<MpPayment>
  searchPayments(token: string, bookingId: string): Promise<MpPayment[]>
  refundPayment(token: string, paymentId: string, amount: number | null): Promise<unknown>
  refreshTokens(refreshToken: string): Promise<MpTokens>
}

export function mercadoPagoApi(app: MpApp, options: MpOptions = {}): MercadoPagoApi {
  return {
    createPreference: (token, input) => createPreference(token, input, options),
    getPayment: (token, id) => getPayment(token, id, options),
    searchPayments: (token, id) => searchPayments(token, id, options),
    refundPayment: (token, id, amount) => refundPayment(token, id, amount, options),
    refreshTokens: (refresh) => refreshTokens(app, refresh, options),
  }
}
