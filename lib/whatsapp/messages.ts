import type { MessageChoices } from "@/lib/db/schema"
import type { OutboundPayload } from "@/lib/integrations/whatsapp/client"
import type { InboundContent } from "@/lib/integrations/whatsapp/webhook"

/*
 * Traducciones entre los mensajes de la app y los de WhatsApp, sin efectos:
 * respuesta del bot → texto, botones o lista; mensaje del cliente → texto
 * que lee el bot. También la ventana de 24 horas.
 */

/** Límites de WhatsApp para mensajes interactivos. */
const BODY_MAX = 1024
const BUTTON_TITLE_MAX = 20
const MAX_BUTTONS = 3
const MAX_ROWS = 10
const DEFAULT_LIST_BUTTON = "Ver opciones"

export const SERVICE_WINDOW_MS = 24 * 3_600_000

/** ¿Se le puede escribir texto libre? Solo dentro de las 24 horas del último mensaje del cliente. */
export function isWindowOpen(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS)
}

/**
 * Cómo se manda una respuesta: una ficha con foto como imagen con epígrafe;
 * con opciones, como botones o lista si entran; si no, como texto numerado.
 */
export function toOutboundPayload(message: {
  body: string | null
  choices: MessageChoices | null
  type?: string
  mediaUrl?: string | null
}): OutboundPayload {
  const text = (message.body ?? "").trim()
  if (message.type === "image" && message.mediaUrl && /^https?:\/\//.test(message.mediaUrl)) {
    return { type: "image", image: { link: message.mediaUrl, ...(text ? { caption: text.slice(0, BODY_MAX) } : {}) } }
  }
  const choices = message.choices?.options ?? []
  if (choices.length === 0) return { type: "text", text: text || "…" }

  const body = text || "Elegí una opción:"
  if (body.length <= BODY_MAX) {
    const fitsButtons =
      choices.length <= MAX_BUTTONS &&
      choices.every((o) => o.title.length <= BUTTON_TITLE_MAX && !o.description)
    if (fitsButtons) {
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: { buttons: choices.map((o) => ({ type: "reply", reply: { id: o.id, title: o.title } })) },
        },
      }
    }
    if (choices.length <= MAX_ROWS) {
      return {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: body },
          action: {
            button: (message.choices?.button ?? DEFAULT_LIST_BUTTON).slice(0, BUTTON_TITLE_MAX),
            sections: [
              {
                rows: choices.map((o) => ({
                  id: o.id,
                  title: o.title.slice(0, 24),
                  ...(o.description ? { description: o.description.slice(0, 72) } : {}),
                })),
              },
            ],
          },
        },
      }
    }
  }
  const lines = choices.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` (${o.description})` : ""}`)
  return { type: "text", text: [body, ...lines].join("\n") }
}

const unsupportedLabels: Record<string, string> = {
  video: "un video",
  document: "un documento",
  sticker: "un sticker",
  location: "una ubicación",
  contacts: "un contacto",
}

export const UNSUPPORTED_REPLY =
  "Por ahora solo puedo leer mensajes de texto, audios e imágenes. ¿Me lo escribís?"

/** Lo que el bot lee de una opción tocada: el título y su detalle, si tenía. */
export function choiceText(content: Extract<InboundContent, { type: "choice" }>): string {
  return content.description ? `${content.title} (${content.description})` : content.title
}

export function unsupportedText(what: string): string {
  return `(Mandó ${unsupportedLabels[what] ?? "un tipo de mensaje que no se puede leer"})`
}

/** "BAJA" deja de recibir recordatorios y promociones; "ALTA" vuelve a recibirlos. */
export function optOutCommand(text: string): "opt_out" | "opt_in" | null {
  const word = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!¡]/g, "")
  if (word === "baja") return "opt_out"
  if (word === "alta") return "opt_in"
  return null
}

export const OPT_OUT_REPLY =
  "Listo, no te vamos a mandar más recordatorios ni promociones. Si querés volver a recibirlos, escribí ALTA."
export const OPT_IN_REPLY = "¡Listo! Vas a volver a recibir los recordatorios de tus turnos."
export const AUDIO_TOO_LONG_REPLY =
  "El audio es un poco largo para mí. ¿Me lo escribís o me mandás uno más corto?"
export const AUDIO_FAILED_REPLY = "No pude escuchar bien el audio. ¿Me lo escribís?"
export const AUDIO_UNAVAILABLE_REPLY = "Por ahora no puedo escuchar audios. ¿Me lo escribís?"
