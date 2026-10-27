import { receiveStripeWebhook } from "@/lib/billing/webhook-route"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return receiveStripeWebhook(request)
}
