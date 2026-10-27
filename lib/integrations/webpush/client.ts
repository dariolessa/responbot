import "server-only"

import webpush from "web-push"

import { env } from "@/lib/env"
import type { PushSender } from "@/lib/notifications/dispatch"

/*
 * Push web con VAPID (docs/SPEC.md, "Push web"). Sin las tres variables
 * (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) el canal
 * queda apagado y la pantalla de Notificaciones no ofrece activarlo.
 */

export function isPushConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export function webPushSender(): PushSender | null {
  if (!isPushConfigured()) return null
  const vapid = {
    subject: env.VAPID_SUBJECT!,
    publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: env.VAPID_PRIVATE_KEY!,
  }
  return {
    async send(subscription, message) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(message),
          { vapidDetails: vapid, TTL: 60 * 60, urgency: "high", timeout: 10_000 },
        )
        return "sent"
      } catch (error) {
        // 404 y 410: el navegador dio de baja la suscripción; se borra.
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) return "gone"
        throw error
      }
    },
  }
}
