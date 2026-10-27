import { startCatalogOAuth } from "@/lib/listings/oauth-route"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return startCatalogOAuth(request, "mercadolibre")
}
