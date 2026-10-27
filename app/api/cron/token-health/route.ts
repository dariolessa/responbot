import { isAuthorizedCron } from "@/lib/cron"
import { checkWhatsAppTokens } from "@/lib/whatsapp/token-health"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ ok: false, error: "No autorizado" }, { status: 401 })
  }
  const whatsapp = await checkWhatsAppTokens()
  return Response.json({ ok: true, cron: "token-health", whatsapp, ranAt: new Date().toISOString() })
}
