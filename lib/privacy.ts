import { lt } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

/*
 * Retención (docs/SPEC.md, "Privacidad"): los mensajes y sus transcripciones
 * se conservan 12 meses. El cron horario borra los más viejos de cada negocio
 * una vez por día (a las 3 de la mañana local).
 */

export const MESSAGE_RETENTION_DAYS = 365
export const PURGE_HOUR = 3

export async function purgeOldMessages(scoped: ScopedDb, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MESSAGE_RETENTION_DAYS * 86_400_000)
  const deleted = await scoped.messages.delete(lt(schema.messages.createdAt, cutoff))
  return deleted.length
}
