import { receiveWebhook, verifyWebhook } from "@/lib/whatsapp/webhook-route"

// El procesamiento sigue después de responder (after); 60 s alcanzan para transcribir y responder.
export const maxDuration = 60
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return verifyWebhook(request)
}

export function POST(request: Request) {
  return receiveWebhook(request)
}
