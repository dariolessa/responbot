import { db } from "@/lib/db"
import { forPlatform } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { resendEvent, undeliverableAddresses, verifyResendSignature } from "@/lib/integrations/resend/webhook"

export const dynamic = "force-dynamic"

/*
 * Rebotes y quejas de Resend (docs/SPEC.md, "Rutas de API"): la dirección
 * queda marcada y el despachador deja de mandarle correos de avisos.
 */
export async function POST(request: Request) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "El webhook de Resend no está configurado" }, { status: 503 })
  }
  const body = await request.text()
  const valid = verifyResendSignature(
    env.RESEND_WEBHOOK_SECRET,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  )
  if (!valid) return Response.json({ ok: false, error: "Firma inválida" }, { status: 401 })

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  const event = resendEvent.safeParse(json)
  if (!event.success) return Response.json({ ok: true, ignored: true })

  const platform = forPlatform(db)
  let marked = 0
  for (const address of undeliverableAddresses(event.data)) {
    marked += await platform.markEmailBounced(address, new Date())
  }
  return Response.json({ ok: true, marked })
}
