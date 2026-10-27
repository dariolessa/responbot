import { cronHandler } from "@/lib/cron"
import { runExpireHolds } from "@/lib/notifications/cron"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export const GET = cronHandler("expire-holds", () => runExpireHolds())
