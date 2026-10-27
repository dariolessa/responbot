import { and, gte, lt, ne } from "drizzle-orm"

import { isWithinOpeningHours, loadCatalog } from "@/lib/bot/catalog"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatZoned, minutesOfDay, toDateString, weekdayOf, zonedToUtc, type DateString } from "@/lib/time"

/*
 * Estadísticas del mes (docs/SPEC.md, pantalla Estadísticas): turnos e
 * ingresos, inasistencias, horarios más pedidos y turnos tomados fuera de
 * horario. `computeMonthStats` es pura; `loadMonthStats` trae los turnos.
 *
 * - Turnos: los del mes por fecha del turno, sin cancelados, vencidos ni los
 *   del chat de prueba.
 * - Ingresos: atendidos (cobrados) y a cobrar (los que siguen abiertos); las
 *   inasistencias no suman.
 * - Fuera de horario: reservas que tomó el bot por WhatsApp en un momento en
 *   que ningún profesional trabajaba.
 */

export type StatsBooking = Pick<schema.Booking, "startsAt" | "createdAt" | "status" | "price" | "source">

export type MonthStats = {
  bookings: number
  completed: number
  open: number
  noShows: number
  cancelled: number
  /** Inasistencias sobre los turnos que ya se resolvieron (atendidos + no vino), 0 a 100. */
  noShowRate: number
  revenue: number
  pendingRevenue: number
  byBot: number
  outsideHours: number
  /** Turnos por hora de inicio (0–23), solo las horas con turnos, en orden. */
  byHour: { hour: number; count: number }[]
  /** Turnos por día de la semana (0 = domingo). */
  byWeekday: { weekday: number; count: number }[]
  /** Las franjas (día + hora) más pedidas, de mayor a menor. */
  topSlots: { weekday: number; hour: number; count: number }[]
}

const notCounted = new Set(["cancelled", "expired"])
const openStatuses = new Set(["pending_payment", "confirmed", "client_confirmed"])

export function computeMonthStats(
  rows: StatsBooking[],
  input: { timezone: string; isOpenAt: (instant: Date) => boolean },
): MonthStats {
  const tz = input.timezone
  const real = rows.filter((b) => b.source !== "test_chat")
  const counted = real.filter((b) => !notCounted.has(b.status))
  const completed = counted.filter((b) => b.status === "completed")
  const noShows = counted.filter((b) => b.status === "no_show")
  const open = counted.filter((b) => openStatuses.has(b.status))
  const byBot = counted.filter((b) => b.source === "whatsapp")

  const hours = new Map<number, number>()
  const weekdays = new Map<number, number>()
  const slots = new Map<string, number>()
  for (const b of counted) {
    const hour = Math.floor(minutesOfDay(b.startsAt, tz) / 60)
    const weekday = weekdayOf(toDateString(b.startsAt, tz))
    hours.set(hour, (hours.get(hour) ?? 0) + 1)
    weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + 1)
    const key = `${weekday}:${hour}`
    slots.set(key, (slots.get(key) ?? 0) + 1)
  }

  const resolved = completed.length + noShows.length
  return {
    bookings: counted.length,
    completed: completed.length,
    open: open.length,
    noShows: noShows.length,
    cancelled: real.filter((b) => b.status === "cancelled").length,
    noShowRate: resolved ? Math.round((noShows.length / resolved) * 100) : 0,
    revenue: completed.reduce((sum, b) => sum + b.price, 0),
    pendingRevenue: open.reduce((sum, b) => sum + b.price, 0),
    byBot: byBot.length,
    outsideHours: byBot.filter((b) => !input.isOpenAt(b.createdAt)).length,
    byHour: [...hours].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour),
    byWeekday: [...weekdays].map(([weekday, count]) => ({ weekday, count })).sort((a, b) => a.weekday - b.weekday),
    topSlots: [...slots]
      .map(([key, count]) => {
        const [weekday, hour] = key.split(":").map(Number)
        return { weekday: weekday!, hour: hour!, count }
      })
      .sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour)
      .slice(0, 5),
  }
}

/** "2026-10" → primer día del mes y del siguiente. */
export function monthBounds(month: string): { first: DateString; next: DateString } {
  const [y, m] = month.split("-").map(Number) as [number, number]
  const pad = (n: number) => String(n).padStart(2, "0")
  const nextYear = m === 12 ? y + 1 : y
  const nextMonth = m === 12 ? 1 : m + 1
  return { first: `${y}-${pad(m)}-01` as DateString, next: `${nextYear}-${pad(nextMonth)}-01` as DateString }
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

export function currentMonth(now: Date, timezone: string): string {
  return formatZoned(now, timezone, "yyyy-MM")
}

export function isMonthString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export async function loadMonthStats(scoped: ScopedDb, month: string, timezone: string, currency: string) {
  const { first, next } = monthBounds(month)
  const [rows, catalog] = await Promise.all([
    scoped.bookings.findMany({
      where: and(
        gte(schema.bookings.startsAt, zonedToUtc(first, "00:00", timezone)),
        lt(schema.bookings.startsAt, zonedToUtc(next, "00:00", timezone)),
        ne(schema.bookings.source, "test_chat"),
      ),
    }),
    loadCatalog(scoped, currency),
  ])
  return computeMonthStats(rows, {
    timezone,
    isOpenAt: (instant) =>
      isWithinOpeningHours(catalog.staff, weekdayOf(toDateString(instant, timezone)), minutesOfDay(instant, timezone)),
  })
}
