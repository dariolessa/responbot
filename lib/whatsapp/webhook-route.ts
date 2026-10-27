import "server-only"

import { after } from "next/server"

import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { parseWebhook, verifySignature, webhookPayload } from "@/lib/integrations/whatsapp/webhook"

import { whatsappDeps } from "./deps"
import { processWebhookEvents } from "./inbound"

/*
 * Webhook único de WhatsApp (docs/SPEC.md): GET responde la verificación de
 * Meta; POST valida la firma, responde 200 de inmediato y procesa después de
 * la respuesta (after → waitUntil en Vercel).
 */

export function verifyWebhook(request: Request): Response {
  const params = new URL(request.url).searchParams
  const token = params.get("hub.verify_token")
  if (
    params.get("hub.mode") === "subscribe" &&
    env.WHATSAPP_VERIFY_TOKEN &&
    token === env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } })
  }
  return new Response("Forbidden", { status: 403 })
}

export async function receiveWebhook(request: Request): Promise<Response> {
  if (!env.META_APP_SECRET) {
    return Response.json({ ok: false, error: "WhatsApp no está configurado" }, { status: 503 })
  }
  const raw = await request.text()
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    return Response.json({ ok: false, error: "Firma inválida" }, { status: 401 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  const payload = webhookPayload.safeParse(json)
  // Firmado por Meta pero con otra forma (otro producto o un campo que no usamos): se acepta y se ignora.
  if (!payload.success || payload.data.object !== "whatsapp_business_account") {
    return Response.json({ ok: true, ignored: true })
  }

  const events = parseWebhook(payload.data)
  if (events.length > 0) {
    after(() => processWebhookEvents(db, events, whatsappDeps()))
  }
  return Response.json({ ok: true })
}
