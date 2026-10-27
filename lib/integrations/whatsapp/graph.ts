/*
 * Llamadas a la Graph API de Meta (WhatsApp Cloud API). Solo la API oficial:
 * https://graph.facebook.com/<versión>/... con el token del negocio.
 *
 * `fetch` es inyectable para que los tests simulen a Meta sin red.
 */

export const GRAPH_BASE = "https://graph.facebook.com"

export type GraphOptions = {
  version: string
  token?: string
  fetch?: typeof fetch
}

/** Error de la Graph API con el código de Meta (190 = token vencido o inválido). */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message)
    this.name = "GraphError"
  }

  /** El token ya no sirve: hay que reconectar WhatsApp. */
  get tokenInvalid(): boolean {
    return this.code === 190 || this.status === 401
  }
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } }

export async function graphRequest<T>(
  options: GraphOptions,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown> | URLSearchParams,
): Promise<T> {
  const doFetch = options.fetch ?? fetch
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}/${options.version}/${path.replace(/^\//, "")}`
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  let payload: string | undefined
  if (body instanceof URLSearchParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    payload = body.toString()
  } else if (body) {
    headers["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }

  const response = await doFetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(20_000) })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Respuesta que no es JSON: se informa con el estado HTTP.
  }
  if (!response.ok) {
    const error = (json as GraphErrorBody | null)?.error
    throw new GraphError(
      error?.message ?? `Graph API respondió ${response.status}`,
      response.status,
      error?.code,
      error?.error_subcode,
    )
  }
  return json as T
}
