import { eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { GraphError } from "@/lib/integrations/whatsapp/graph"

import { markWhatsAppBroken } from "./connection"
import { toOutboundPayload } from "./messages"

/*
 * Envío de mensajes guardados (respuestas del bot o del equipo) por WhatsApp.
 * El mensaje ya está en la base en estado "queued"; acá se manda, se guarda
 * su wamid y pasa a "sent", o queda "failed" con el motivo. Los estados
 * siguientes (entregado, leído) llegan por el webhook.
 */

const statusRank: Record<schema.Message["status"], number> = {
  received: 0,
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

/** Un estado del webhook solo avanza: un "entregado" que llega tarde no pisa un "leído". */
export function shouldApplyStatus(current: schema.Message["status"], next: schema.Message["status"]): boolean {
  if (next === "failed") return current !== "read" && current !== "failed"
  return statusRank[next] > statusRank[current]
}

/** Motivo para mostrar en el panel, sin jerga; el detalle técnico va al log. */
export function deliveryError(error: unknown): string {
  if (error instanceof GraphError) {
    if (error.tokenInvalid) return "Hay que volver a conectar WhatsApp desde Configuración."
    return failedStatusError(error.code ?? null)
  }
  return "No pudimos comunicarnos con WhatsApp."
}

/** Motivo de un estado "failed" que llega por el webhook, según el código de Meta. */
export function failedStatusError(code: number | null): string {
  if (code === 131047) return "Pasaron más de 24 horas desde el último mensaje del cliente."
  if (code === 131026) return "Ese número no puede recibir el mensaje (puede que no tenga WhatsApp)."
  return "WhatsApp no lo pudo entregar."
}

export async function deliverMessage(
  scoped: ScopedDb,
  api: WhatsAppApi,
  to: string,
  message: schema.Message,
  /** Lo que se manda si no es el texto o las opciones del mensaje (por ejemplo, una plantilla). */
  payload?: OutboundPayload,
): Promise<schema.Message> {
  try {
    const { wamid } = await api.send(to, payload ?? toOutboundPayload(message))
    const [sent] = await scoped.messages.update(eq(schema.messages.id, message.id), {
      wamid,
      status: "sent",
      error: null,
    })
    return sent ?? message
  } catch (error) {
    console.error("[whatsapp] no se pudo enviar", error instanceof Error ? error.message : error)
    const [failed] = await scoped.messages.update(eq(schema.messages.id, message.id), {
      status: "failed",
      error: deliveryError(error),
    })
    // Token vencido o revocado: hay que reconectar WhatsApp.
    if (error instanceof GraphError && error.tokenInvalid) {
      await markWhatsAppBroken(scoped, "token_expired")
    }
    return failed ?? message
  }
}
