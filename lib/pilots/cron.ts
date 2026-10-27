import "server-only"

import { db } from "@/lib/db"

import { runDemoReset } from "./demo"

/** Cron demo-reset (todas las noches): borra lo que dejaron los visitantes de la demo. */
export function runDemoResetCron() {
  return runDemoReset(db)
}
