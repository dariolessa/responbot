import "server-only"

import { after } from "next/server"
import { z } from "zod"

import { can } from "@/lib/auth/roles"
import { getTenant } from "@/lib/auth/tenant"
import { completeSignup } from "@/lib/integrations/whatsapp/signup"
import { GraphError } from "@/lib/integrations/whatsapp/graph"
import { submitMissingTemplates } from "@/lib/integrations/whatsapp/templates"

import { requestAppSyncs } from "./coexistence"
import { ConnectionError, saveWhatsAppConnection } from "./connection"
import { encryptToken, graphOptions, isWhatsAppConfigured, metaApp } from "./deps"

/*
 * POST /api/integrations/whatsapp/signup: canje del código de Embedded Signup.
 * Lo llama el botón "Conectar WhatsApp" de Configuración con lo que devolvió
 * el popup de Meta.
 */

const signupInput = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().regex(/^\d{5,30}$/),
  // En coexistencia Meta puede no mandarlo; se busca en la WABA.
  phoneNumberId: z.string().regex(/^\d{5,30}$/).nullish(),
  coexistence: z.boolean().optional(),
  metaUserId: z.string().regex(/^\d{1,40}$/).nullish(),
})

export async function handleSignup(request: Request): Promise<Response> {
  const tenant = await getTenant()
  if (!can(tenant.role, "manageConnections")) {
    return Response.json({ ok: false, error: "No tenés permiso para conectar WhatsApp." }, { status: 403 })
  }
  if (!isWhatsAppConfigured()) {
    return Response.json({ ok: false, error: "La conexión con WhatsApp todavía no está configurada." }, { status: 503 })
  }
  const parsed = signupInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Faltan datos de Meta. Probá conectar de nuevo." }, { status: 400 })
  }

  try {
    const result = await completeSignup(parsed.data, metaApp(), graphOptions())
    const account = await saveWhatsAppConnection(tenant.db, tenant.user.id, result, encryptToken)
    // Las plantillas (y en coexistencia, los contactos y el historial) se piden sin hacer esperar al dueño.
    after(async () => {
      if (account.coexistence) {
        try {
          await requestAppSyncs(tenant.db, account, graphOptions(result.token))
        } catch (error) {
          console.error("[whatsapp] no se pudieron pedir contactos e historial", error)
        }
      }
      try {
        await submitMissingTemplates(account.wabaId, graphOptions(result.token))
      } catch (error) {
        console.error("[whatsapp] no se pudieron enviar las plantillas", error)
      }
    })
    return Response.json({ ok: true, displayPhone: account.displayPhone })
  } catch (error) {
    if (error instanceof ConnectionError) return Response.json({ ok: false, error: error.message }, { status: 409 })
    console.error("[whatsapp] falló el alta embebida", error instanceof GraphError ? error.message : error)
    return Response.json(
      { ok: false, error: "Meta no confirmó la conexión. Probá de nuevo en unos minutos." },
      { status: 502 },
    )
  }
}
