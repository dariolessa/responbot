import { startMpOAuth } from "@/lib/payments/oauth-route"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return startMpOAuth(request)
}
