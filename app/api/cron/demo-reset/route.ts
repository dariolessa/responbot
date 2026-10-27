import { cronHandler } from "@/lib/cron"
import { runDemoResetCron } from "@/lib/pilots/cron"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export const GET = cronHandler("demo-reset", () => runDemoResetCron())
