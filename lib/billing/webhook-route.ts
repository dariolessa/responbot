import "server-only"

import { after } from "next/server"

import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { stripeEvent, verifyStripeSignature } from "@/lib/integrations/stripe/webhook"
import { flushBusiness } from "@/lib/notifications/deps"

import { billingDeps } from "./deps"
import { handleStripeEvent } from "./stripe"

/*
 * POST /api/webhooks/stripe (docs/SPEC.md): verifica la firma
 * `Stripe-Signature` con STRIPE_WEBHOOK_SECRET y copia el estado de la
 * suscripción al negocio. Se procesa antes de responder: si algo falla, el
 * 500 hace que Stripe reintente.
 */
export async function receiveStripeWebhook(request: Request): Promise<Response> {
  const deps = billingDeps()
  if (!deps || !env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "Stripe no está configurado" }, { status: 503 })
  }
  const payload = await request.text()
  const valid = verifyStripeSignature({
    payload,
    header: request.headers.get("stripe-signature"),
    secret: env.STRIPE_WEBHOOK_SECRET,
  })
  if (!valid) return Response.json({ ok: false, error: "Firma inválida" }, { status: 401 })

  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  const event = stripeEvent.safeParse(json)
  if (!event.success) return Response.json({ ok: true, ignored: true })

  try {
    const result = await handleStripeEvent(db, event.data, deps)
    const businessId = result.businessId
    // El aviso de pago fallido sale por correo enseguida.
    if (businessId) {
      after(() =>
        flushBusiness(db, businessId).catch((error: unknown) => {
          console.error("[avisos] no se pudo vaciar lo pendiente", businessId, error)
        }),
      )
    }
    return Response.json({ ok: true, handled: result.handled })
  } catch (error) {
    console.error("[stripe] falló el webhook", event.data.type, event.data.id, error instanceof Error ? error.message : error)
    return Response.json({ ok: false }, { status: 500 })
  }
}
