import { graphRequest, GraphError, type GraphOptions } from "./graph"

/*
 * Mensajería de WhatsApp Cloud API para un número (phone_number_id) de un
 * negocio. El resto de la app usa la interfaz WhatsAppApi; los tests le pasan
 * una versión simulada.
 */

export type InteractivePayload =
  | {
      type: "button"
      body: { text: string }
      action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] }
    }
  | {
      type: "list"
      body: { text: string }
      action: {
        button: string
        sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]
      }
    }

export type TemplatePayload = {
  name: string
  language: { code: string }
  components?: Record<string, unknown>[]
}

export type OutboundPayload =
  | { type: "text"; text: string }
  | { type: "interactive"; interactive: InteractivePayload }
  | { type: "template"; template: TemplatePayload }
  /** Imagen por link público (WhatsApp la descarga); el epígrafe admite hasta 1024 caracteres. */
  | { type: "image"; image: { link: string; caption?: string } }

export type WhatsAppApi = {
  /** Envía un mensaje y devuelve su wamid. `to` en E.164 (con o sin "+"). */
  send(to: string, payload: OutboundPayload): Promise<{ wamid: string }>
  /** Marca el mensaje como leído y, opcionalmente, muestra "escribiendo…". */
  markRead(wamid: string, options?: { typing?: boolean }): Promise<void>
  /** Descarga un medio (audio, imagen) por su id. */
  downloadMedia(mediaId: string): Promise<{ data: Uint8Array; mimeType: string }>
}

/** Límite de tamaño de lo que se descarga (los audios de WhatsApp pesan mucho menos). */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024

export function toWhatsAppNumber(e164: string): string {
  return e164.replace(/^\+/, "")
}

export function cloudApi(
  account: { phoneNumberId: string; token: string },
  options: Omit<GraphOptions, "token">,
): WhatsAppApi {
  const graph: GraphOptions = { ...options, token: account.token }
  const doFetch = options.fetch ?? fetch

  return {
    async send(to, payload) {
      const body: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toWhatsAppNumber(to),
        type: payload.type,
      }
      if (payload.type === "text") body.text = { body: payload.text, preview_url: false }
      else if (payload.type === "interactive") body.interactive = payload.interactive
      else if (payload.type === "image") body.image = payload.image
      else body.template = payload.template

      const result = await graphRequest<{ messages?: { id: string }[] }>(
        graph,
        "POST",
        `${account.phoneNumberId}/messages`,
        body,
      )
      const wamid = result.messages?.[0]?.id
      if (!wamid) throw new GraphError("WhatsApp no devolvió el id del mensaje", 200)
      return { wamid }
    },

    async markRead(wamid, { typing = false } = {}) {
      await graphRequest(graph, "POST", `${account.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        ...(typing ? { typing_indicator: { type: "text" } } : {}),
      })
    },

    async downloadMedia(mediaId) {
      const info = await graphRequest<{ url: string; mime_type: string; file_size?: number }>(
        graph,
        "GET",
        mediaId,
      )
      if (info.file_size && info.file_size > MAX_MEDIA_BYTES) {
        throw new GraphError("El archivo es demasiado grande", 413)
      }
      const response = await doFetch(info.url, {
        headers: { Authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new GraphError(`No se pudo descargar el medio (${response.status})`, response.status)
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > MAX_MEDIA_BYTES) throw new GraphError("El archivo es demasiado grande", 413)
      return { data, mimeType: info.mime_type.split(";")[0]!.trim() }
    },
  }
}
