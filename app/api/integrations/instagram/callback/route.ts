import { finishCatalogOAuth } from "@/lib/listings/oauth-route"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return finishCatalogOAuth(request, "instagram")
}
