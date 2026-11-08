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
 *
 * Coexistencia (el dueño sigue usando la app WhatsApp Business en el celular,
 * featureType "whatsapp_business_app_onboarding" en el alta): el número ya
 * vive en la app, así que no se registra con PIN (Meta no lo permite). Si el
 * popup no trae el phone_number_id, se busca en los números de la WABA.
 * Después hay 24 horas para pedirle a Meta los contactos y el historial de la
 * app (`requestAppSync`).
 */

export type MetaApp = { appId: string; appSecret: string }

export type SignupResult = {
  token: string
  wabaId: string
  phoneNumberId: string
  displayPhone: string
  verifiedName: string | null
  /** Nulo en coexistencia: el número no se registra con PIN. */
  pin: string | null
  /** false si el número ya estaba registrado o Meta no lo dejó registrar (se puede reintentar). */
  registered: boolean
  /** El número sigue andando también en la app WhatsApp Business del celular. */
  coexistence: boolean
  /** Id de Facebook (con alcance de la app) de quien hizo el alta, si el SDK lo devolvió. */
  metaUserId: string | null
}

export type SignupInput = {
  code: string
  wabaId: string
  /** Puede faltar en coexistencia; se resuelve con los números de la WABA. */
  phoneNumberId?: string | null
  coexistence?: boolean
  metaUserId?: string | null
}

type PhoneNumberRow = { id: string; display_phone_number?: string; verified_name?: string }

/** El número de la WABA; si hay varios, el que no es de prueba primero. */
export async function findWabaNumber(wabaId: string, options: GraphOptions): Promise<string> {
  const result = await graphRequest<{ data?: PhoneNumberRow[] }>(
    options,
    "GET",
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
  )
  const id = result.data?.[0]?.id
  if (!id) throw new GraphError("La cuenta de WhatsApp Business no tiene un número", 200)
  return id
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
  input: SignupInput,
  app: MetaApp,
  options: Omit<GraphOptions, "token">,
): Promise<SignupResult> {
  const coexistence = Boolean(input.coexistence)
  const token = await exchangeCode(input.code, app, options)
  const graph: GraphOptions = { ...options, token }

  await graphRequest(graph, "POST", `${input.wabaId}/subscribed_apps`)

  const phoneNumberId = input.phoneNumberId || (await findWabaNumber(input.wabaId, graph))

  let pin: string | null = null
  let registered = !coexistence
  if (!coexistence) {
    pin = newPin()
    try {
      await graphRequest(graph, "POST", `${phoneNumberId}/register`, { messaging_product: "whatsapp", pin })
    } catch (error) {
      // Un número que ya usaba Cloud API puede estar registrado; no frena el alta.
      if (!(error instanceof GraphError)) throw error
      console.warn("[whatsapp] no se pudo registrar el número", error.code, error.message)
      registered = false
    }
  }

  const info = await graphRequest<{ display_phone_number?: string; verified_name?: string }>(
    graph,
    "GET",
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
  )

  return {
    token,
    wabaId: input.wabaId,
    phoneNumberId,
    displayPhone: info.display_phone_number ?? phoneNumberId,
    verifiedName: info.verified_name ?? null,
    pin,
    registered,
    coexistence,
    metaUserId: input.metaUserId ?? null,
  }
}

export type AppSyncType = "smb_app_state_sync" | "history"

/**
 * Coexistencia: le pide a Meta que mande por webhook los contactos
 * (smb_app_state_sync) o el historial de chats (history) de la app
 * WhatsApp Business. Solo dentro de las 24 horas desde el alta y una vez por
 * tipo; para repetirlo hay que desconectar y volver a conectar.
 */
export async function requestAppSync(phoneNumberId: string, syncType: AppSyncType, options: GraphOptions) {
  return graphRequest<{ request_id?: string }>(options, "POST", `${phoneNumberId}/smb_app_data`, {
    messaging_product: "whatsapp",
    sync_type: syncType,
  })
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
