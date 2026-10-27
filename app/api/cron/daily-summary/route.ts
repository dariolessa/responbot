import { cronHandler } from "@/lib/cron"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export const GET = cronHandler("daily-summary")
