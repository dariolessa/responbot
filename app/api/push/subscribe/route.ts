import { z } from "zod"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { forUser } from "@/lib/db/scoped"

export const dynamic = "force-dynamic"

/*
 * Suscripción push de un dispositivo (docs/SPEC.md, "Push web"): POST la
 * guarda, DELETE la borra. Es de la cuenta, no del negocio: un mismo celular
 * recibe los avisos de todos sus negocios.
 */

const subscription = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
})

async function userId() {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function POST(request: Request) {
  const id = await userId()
  if (!id) return Response.json({ ok: false, error: "Entrá de nuevo" }, { status: 401 })
  const parsed = subscription.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ ok: false, error: "Suscripción inválida" }, { status: 400 })
  await forUser(db, id).savePushSubscription({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  })
  return Response.json({ ok: true })
}

export async function DELETE(request: Request) {
  const id = await userId()
  if (!id) return Response.json({ ok: false, error: "Entrá de nuevo" }, { status: 401 })
  const parsed = z.object({ endpoint: z.url().max(2000) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ ok: false, error: "Falta el dispositivo" }, { status: 400 })
  await forUser(db, id).deletePushSubscription(parsed.data.endpoint)
  return Response.json({ ok: true })
}
