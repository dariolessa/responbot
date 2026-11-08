import "server-only"

import { publicAppUrl } from "@/lib/app-url"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { unsubscribeApp } from "@/lib/integrations/whatsapp/signup"
import { parseSignedRequest } from "@/lib/integrations/whatsapp/signed-request"
import { dataDeletionStatus, handleDataDeletionRequest } from "@/lib/meta-data-deletion"

import { accountToken, graphOptions } from "./deps"

/*
 * POST /api/meta/data-deletion: callback de eliminación de datos de la app de
 * Meta. Valida el signed_request con META_APP_SECRET, borra los datos
 * asociados a ese usuario de Facebook (lib/meta-data-deletion.ts) y responde
 * lo que pide Meta: la URL de estado y el código de confirmación.
 */

async function readSignedRequest(request: Request): Promise<string | null> {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { signed_request?: unknown } | null
    return typeof body?.signed_request === "string" ? body.signed_request : null
  }
  const form = await request.formData().catch(() => null)
  const value = form?.get("signed_request")
  return typeof value === "string" ? value : null
}

export async function handleDataDeletion(request: Request): Promise<Response> {
  if (!env.META_APP_SECRET) return Response.json({ error: "not_configured" }, { status: 503 })
  const signed = await readSignedRequest(request)
  const data = signed ? parseSignedRequest(signed, env.META_APP_SECRET) : null
  if (!data?.user_id) return Response.json({ error: "invalid_signed_request" }, { status: 400 })

  const outcome = await handleDataDeletionRequest(db, String(data.user_id), {
    unsubscribe: async (account) => {
      if (account.status === "active") await unsubscribeApp(account.wabaId, graphOptions(accountToken(account)))
    },
  })
  console.info("[meta] pedido de eliminación de datos", { code: outcome.code, status: outcome.status })

  const url = new URL("/eliminacion-datos", publicAppUrl())
  url.searchParams.set("code", outcome.code)
  return Response.json({ url: url.toString(), confirmation_code: outcome.code })
}

/** Estado de un pedido para la página /eliminacion-datos?code=… */
export function deletionRequestStatus(code: string) {
  return dataDeletionStatus(db, code.trim().toUpperCase())
}
