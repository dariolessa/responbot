import { eq, sql } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatZoned } from "@/lib/time"

/*
 * Consumo por negocio y mes (usage_counters), para controlar costos por plan
 * (docs/SPEC.md, "Planes y facturación").
 */

export type UsageDelta = {
  conversations?: number
  aiInputTokens?: number
  aiOutputTokens?: number
  templatesSent?: number
}

/** Mes calendario en la zona del negocio, "YYYY-MM". */
export function usagePeriod(now: Date, timezone: string): string {
  return formatZoned(now, timezone, "yyyy-MM")
}

export async function addUsage(scoped: ScopedDb, period: string, delta: UsageDelta) {
  const values = {
    conversations: delta.conversations ?? 0,
    aiInputTokens: delta.aiInputTokens ?? 0,
    aiOutputTokens: delta.aiOutputTokens ?? 0,
    templatesSent: delta.templatesSent ?? 0,
  }
  if (Object.values(values).every((v) => v === 0)) return

  const where = eq(schema.usageCounters.period, period)
  const existing = await scoped.usageCounters.findFirst(where)
  if (!existing) {
    try {
      await scoped.usageCounters.insert({ period, ...values })
      return
    } catch {
      // Otro mensaje creó la fila del mes al mismo tiempo: se suma abajo.
    }
  }
  const c = schema.usageCounters
  // Suma en la base para no pisar lo que sumó otro mensaje en paralelo.
  await scoped.usageCounters.update(where, {
    conversations: sql`${c.conversations} + ${values.conversations}`,
    aiInputTokens: sql`${c.aiInputTokens} + ${values.aiInputTokens}`,
    aiOutputTokens: sql`${c.aiOutputTokens} + ${values.aiOutputTokens}`,
    templatesSent: sql`${c.templatesSent} + ${values.templatesSent}`,
  } as unknown as Partial<typeof c.$inferInsert>)
}
