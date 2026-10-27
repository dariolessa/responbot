import { randomUUID } from "node:crypto"

import { env } from "@/lib/env"
import { parseSignedRequest } from "@/lib/integrations/whatsapp/signed-request"

export const dynamic = "force-dynamic"

/*
 * Pedido de eliminación de datos que exige Meta (docs/SPEC.md, "Requisitos de
 * Meta"). Responbot no guarda datos de la cuenta de Facebook de quien hizo
 * el alta embebida: solo el token de la WABA del negocio, que se borra al
 * desconectar WhatsApp. Se confirma el pedido con un código y una página de
 * estado que explica cómo borrar los datos del negocio.
 */
export async function POST(request: Request) {
  if (!env.META_APP_SECRET) return Response.json({ error: "No configurado" }, { status: 503 })
  const form = await request.formData().catch(() => null)
  const signed = form?.get("signed_request")
  const data = typeof signed === "string" ? parseSignedRequest(signed, env.META_APP_SECRET) : null
  if (!data) return Response.json({ error: "signed_request inválido" }, { status: 400 })

  const code = randomUUID()
  console.info("[meta] pedido de eliminación de datos", { code })
  const url = new URL(`/eliminacion-de-datos?codigo=${code}`, env.AUTH_URL ?? request.url)
  return Response.json({ url: url.toString(), confirmation_code: code })
}
