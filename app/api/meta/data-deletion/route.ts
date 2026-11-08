import { handleDataDeletion } from "@/lib/whatsapp/data-deletion-route"

export const dynamic = "force-dynamic"

/* Callback de eliminación de datos de Meta (docs/META-APP-REVIEW.md). */
export function POST(request: Request) {
  return handleDataDeletion(request)
}
