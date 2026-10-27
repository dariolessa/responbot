import "server-only"

import { after } from "next/server"

import { db } from "@/lib/db"
import { forBusiness, forPlatform } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { mpNotification, verifyMpSignature } from "@/lib/integrations/mercadopago/webhook"
import { flushBusiness } from "@/lib/notifications/deps"

import { paymentDeps } from "./deps"
import { syncPayment } from "./mercadopago"

/*
 * POST /api/webhooks/mercadopago (docs/SPEC.md): valida la firma
 * `x-signature`, consulta el pago por API con el token del negocio (nunca se
 * confía solo en el cuerpo) y confirma el turno. Se procesa antes de
 * responder: si algo falla, el 500 hace que Mercado Pago reintente.
 */
export async function receiveMpWebhook(request: Request): Promise<Response> {
  const deps = paymentDeps()
  if (!deps) return Response.json({ ok: false, error: "Mercado Pago no está configurado" }, { status: 503 })

  const url = new URL(request.url)
  const raw = await request.text()
  let json: unknown = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  const body = mpNotification.safeParse(json ?? {})
  const notification = body.success ? body.data : {}
  const dataId = url.searchParams.get("data.id") ?? notification.data?.id ?? null

  if (env.MP_WEBHOOK_SECRET) {
    const valid = verifyMpSignature({
      header: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId,
      secret: env.MP_WEBHOOK_SECRET,
    })
    if (!valid) return Response.json({ ok: false, error: "Firma inválida" }, { status: 401 })
  }

  const type = url.searchParams.get("type") ?? notification.type
  if (type !== "payment" || !dataId || !notification.user_id) return Response.json({ ok: true, ignored: true })

  const account = await forPlatform(db).mpAccountByUserId(notification.user_id)
  if (!account) return Response.json({ ok: true, ignored: true })

  try {
    const result = await syncPayment(forBusiness(db, account.businessId), dataId, deps)
    // Confirmación al cliente, aviso al equipo y lista de espera, después de responder.
    after(() =>
      flushBusiness(db, account.businessId).catch((error: unknown) => {
        console.error("[avisos] no se pudo vaciar lo pendiente", account.businessId, error)
      }),
    )
    return Response.json({ ok: true, result })
  } catch (error) {
    console.error("[mercadopago] falló el webhook", dataId, error instanceof Error ? error.message : error)
    return Response.json({ ok: false }, { status: 500 })
  }
}
