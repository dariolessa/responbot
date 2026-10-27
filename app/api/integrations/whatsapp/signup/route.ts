import { handleSignup } from "@/lib/whatsapp/signup-route"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return handleSignup(request)
}
