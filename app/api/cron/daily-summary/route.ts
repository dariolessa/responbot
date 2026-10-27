import { cronHandler } from "@/lib/cron"
import { runDailySummary } from "@/lib/notifications/cron"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export const GET = cronHandler("daily-summary", () => runDailySummary())
