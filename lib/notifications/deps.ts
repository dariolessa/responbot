import "server-only"

import { after } from "next/server"

import { publicAppUrl } from "@/lib/app-url"
import { db } from "@/lib/db"
import { forBusiness, type AnyDb } from "@/lib/db/scoped"
import { sendEmail } from "@/lib/integrations/resend/client"
import { webPushSender } from "@/lib/integrations/webpush/client"
import { apiFor } from "@/lib/whatsapp/deps"
import { sendDueCustomerMessages } from "@/lib/whatsapp/scheduled"

import { deliverPendingNotifications, type DeliveryDeps } from "./dispatch"

/*
 * Canales reales armados desde el entorno, y el "vaciado" de lo pendiente de
 * un negocio: mensajes programados vencidos y avisos sin entregar. Los tests
 * no pasan por acá.
 */

export function deliveryDeps(): DeliveryDeps {
  return {
    push: webPushSender(),
    email: { send: (input) => sendEmail(input) },
    whatsapp: apiFor,
    appUrl: publicAppUrl(),
  }
}

export async function flushBusiness(database: AnyDb, businessId: string, deps = deliveryDeps(), now = new Date()) {
  const scoped = forBusiness(database, businessId)
  const messages = await sendDueCustomerMessages(scoped, deps, now)
  const notifications = await deliverPendingNotifications(scoped, deps, now)
  return { messages, notifications }
}

/** Después de responder (after → waitUntil en Vercel): manda lo que dejó pendiente una acción. */
export function flushSoon(businessId: string) {
  after(async () => {
    try {
      await flushBusiness(db, businessId)
    } catch (error) {
      // Lo que no salió lo levanta el cron de cada 5 minutos.
      console.error("[avisos] no se pudo vaciar lo pendiente", businessId, error)
    }
  })
}
