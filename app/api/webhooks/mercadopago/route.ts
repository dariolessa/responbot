import { receiveMpWebhook } from "@/lib/payments/webhook-route"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return receiveMpWebhook(request)
}
