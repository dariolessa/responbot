import { finishMpOAuth } from "@/lib/payments/oauth-route"

export const maxDuration = 30
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return finishMpOAuth(request)
}
