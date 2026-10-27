import { addDays, format, parseISO } from "date-fns"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"
import { es } from "date-fns/locale"

/*
 * Fechas (CLAUDE.md): en la base todo es UTC; en pantalla, la zona del negocio.
 * Un "día" se representa como texto "yyyy-MM-dd" en la zona del negocio y una
 * hora como "HH:mm".
 */

export type DateString = string

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export function isDateString(value: string): value is DateString {
  return DATE_RE.test(value) && !Number.isNaN(parseISO(value).getTime())
}

export function isTimeString(value: string): boolean {
  return TIME_RE.test(value)
}

/** Instante UTC de una fecha y hora locales del negocio. */
export function zonedToUtc(date: DateString, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${time.slice(0, 5)}:00`, timezone)
}

/** Día del negocio ("yyyy-MM-dd") en el que cae un instante. */
export function toDateString(instant: Date, timezone: string): DateString {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd")
}

/** Hora local "HH:mm" de un instante. */
export function toTimeString(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "HH:mm")
}

/** Minutos desde la medianoche local. */
export function minutesOfDay(instant: Date, timezone: string): number {
  const [h, m] = toTimeString(instant, timezone).split(":").map(Number)
  return h! * 60 + m!
}

/** "09:30" o "09:30:00" → 570. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h! * 60 + m!
}

/** 570 → "09:30". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** Suma días a una fecha "yyyy-MM-dd" (sin zona: es aritmética de calendario). */
export function addDaysToDate(date: DateString, days: number): DateString {
  return format(addDays(parseISO(date), days), "yyyy-MM-dd")
}

/** 0 = domingo … 6 = sábado, como working_hours.weekday. */
export function weekdayOf(date: DateString): number {
  return parseISO(date).getDay()
}

/** Lunes de la semana de esa fecha. */
export function startOfWeekDate(date: DateString): DateString {
  const weekday = weekdayOf(date)
  return addDaysToDate(date, weekday === 0 ? -6 : 1 - weekday)
}

/** Rango UTC [inicio, fin) de un día local del negocio. */
export function dayRange(date: DateString, timezone: string): { start: Date; end: Date } {
  return {
    start: zonedToUtc(date, "00:00", timezone),
    end: zonedToUtc(addDaysToDate(date, 1), "00:00", timezone),
  }
}

/** Días entre dos fechas, ambas incluidas. */
export function datesBetween(from: DateString, to: DateString): DateString[] {
  const out: DateString[] = []
  for (let d = from; d <= to; d = addDaysToDate(d, 1)) out.push(d)
  return out
}

/** Formato para pantalla en la zona del negocio, en español. */
export function formatZoned(instant: Date, timezone: string, pattern: string): string {
  return formatInTimeZone(instant, timezone, pattern, { locale: es })
}

/** Formato de una fecha "yyyy-MM-dd" en español, por ejemplo "martes 27 de octubre". */
export function formatDate(date: DateString, pattern = "EEEE d 'de' MMMM"): string {
  return format(parseISO(date), pattern, { locale: es })
}

export const weekdayLabels = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const

export const weekdayShortLabels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const

/** Lunes primero, como se lee una semana de trabajo. */
export const weekdaysMondayFirst = [1, 2, 3, 4, 5, 6, 0] as const
