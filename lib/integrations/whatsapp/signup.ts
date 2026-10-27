import { randomInt } from "node:crypto"

import { graphRequest, GraphError, type GraphOptions } from "./graph"

/*
 * Alta embebida de Meta (Embedded Signup). El navegador termina el flujo con
 * un código de un solo uso más el waba_id y el phone_number_id; acá se canjea
 * el código por el token del negocio y se deja el número listo:
 *
 * 1. Canje del código por el token (business integration system user).
 * 2. Suscripción de nuestra app a los webhooks de esa WABA.
 * 3. Registro del número en Cloud API con un PIN de dos pasos propio.
 * 4. Lectura del número visible y el nombre verificado.
 */

export type MetaApp = { appId: string; appSecret: string }

export type SignupResult = {
  token: string
  wabaId: string
  phoneNumberId: string
  displayPhone: string
  verifiedName: string | null
  pin: string
  /** false si el número ya estaba registrado o Meta no lo dejó registrar (se puede reintentar). */
  registered: boolean
}

export async function exchangeCode(code: string, app: MetaApp, options: GraphOptions): Promise<string> {
  const query = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code })
  const result = await graphRequest<{ access_token?: string }>(options, "GET", `oauth/access_token?${query}`)
  if (!result.access_token) throw new GraphError("Meta no devolvió el token", 200)
  return result.access_token
}

export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

export async function completeSignup(
  input: { code: string; wabaId: string; phoneNumberId: string },
  app: MetaApp,
  options: Omit<GraphOptions, "token">,
): Promise<SignupResult> {
  const token = await exchangeCode(input.code, app, options)
  const graph: GraphOptions = { ...options, token }

  await graphRequest(graph, "POST", `${input.wabaId}/subscribed_apps`)

  const pin = newPin()
  let registered = true
  try {
    await graphRequest(graph, "POST", `${input.phoneNumberId}/register`, { messaging_product: "whatsapp", pin })
  } catch (error) {
    // Un número que ya usaba Cloud API puede estar registrado; no frena el alta.
    if (!(error instanceof GraphError)) throw error
    console.warn("[whatsapp] no se pudo registrar el número", error.code, error.message)
    registered = false
  }

  const info = await graphRequest<{ display_phone_number?: string; verified_name?: string }>(
    graph,
    "GET",
    `${input.phoneNumberId}?fields=display_phone_number,verified_name`,
  )

  return {
    token,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhone: info.display_phone_number ?? input.phoneNumberId,
    verifiedName: info.verified_name ?? null,
    pin,
    registered,
  }
}

/** Saca la suscripción de la app a la WABA (al desconectar). */
export async function unsubscribeApp(wabaId: string, options: GraphOptions): Promise<void> {
  await graphRequest(options, "DELETE", `${wabaId}/subscribed_apps`)
}

/** Revisa que el token siga sirviendo (cron token-health). */
export async function checkToken(phoneNumberId: string, options: GraphOptions): Promise<"ok" | "invalid"> {
  try {
    await graphRequest(options, "GET", `${phoneNumberId}?fields=id`)
    return "ok"
  } catch (error) {
    if (error instanceof GraphError && error.tokenInvalid) return "invalid"
    throw error
  }
}
