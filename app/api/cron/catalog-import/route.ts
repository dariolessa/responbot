import { cronHandler } from "@/lib/cron"
import { reimportDueSources } from "@/lib/listings/deps"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export const GET = cronHandler("catalog-import", () => reimportDueSources())
