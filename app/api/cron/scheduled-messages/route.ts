import { cronHandler } from "@/lib/cron"
import { runScheduledMessages } from "@/lib/notifications/cron"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export const GET = cronHandler("scheduled-messages", () => runScheduledMessages())
