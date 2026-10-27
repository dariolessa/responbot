import { z } from "zod"

import { parseMoney } from "@/lib/money"
import { isDateString, isTimeString, timeToMinutes } from "@/lib/time"

/*
 * Esquemas Zod compartidos por el asistente de alta y el panel. Los mensajes
 * de error se muestran tal cual: en español y sin jerga.
 */

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string> }
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure

export function ok(): ActionResult
export function ok<T>(data: T): ActionResult<T>
export function ok<T>(data?: T): ActionResult<T | null> {
  return { ok: true, data: data ?? null }
}

export function fail(error: string, fields?: Record<string, string>): ActionFailure {
  return { ok: false, error, fieldErrors: fields }
}

/** Primer mensaje de cada campo, con la ruta unida por puntos ("services.2.price"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    out[key] ??= issue.message
  }
  return out
}

export function invalid(error: z.ZodError, message = "Revisá los datos marcados."): ActionFailure {
  return { ok: false, error: message, fieldErrors: fieldErrors(error) }
}

/** Monto escrito por la persona ("1.250", "1250,50") → centésimos. */
export const moneyInput = z
  .string({ error: "Escribí un precio." })
  .trim()
  .min(1, { error: "Escribí un precio." })
  .transform((value, ctx) => {
    const cents = parseMoney(value)
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Escribí un monto válido, por ejemplo 1250." })
      return z.NEVER
    }
    return cents
  })

/** Monto opcional: vacío → null. */
export const optionalMoneyInput = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null
    const cents = parseMoney(value)
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Escribí un monto válido, por ejemplo 300." })
      return z.NEVER
    }
    return cents
  })

export const dateInput = z.string().refine(isDateString, { error: "Elegí una fecha válida." })
export const timeInput = z.string().refine(isTimeString, { error: "Elegí una hora válida." })

export const serviceInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Escribí el nombre del servicio." })
    .max(80, { error: "El nombre es muy largo." }),
  description: z
    .string()
    .trim()
    .max(500, { error: "La descripción es muy larga." })
    .optional()
    .transform((v) => v || null),
  durationMinutes: z.coerce
    .number({ error: "Elegí la duración." })
    .int()
    .min(5, { error: "La duración mínima es 5 minutos." })
    .max(720, { error: "La duración máxima es 12 horas." }),
  price: moneyInput,
})

export type ServiceInput = z.input<typeof serviceInput>

/** Un tramo del horario semanal. */
export const weeklyRangeInput = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeInput,
    endTime: timeInput,
  })
  .refine((r) => timeToMinutes(r.startTime) < timeToMinutes(r.endTime), {
    error: "La hora de fin tiene que ser después de la de inicio.",
    path: ["endTime"],
  })

/** Horario semanal: varios tramos por día que no se pisan. */
export const weeklyHoursInput = z.array(weeklyRangeInput).superRefine((ranges, ctx) => {
  for (let day = 0; day < 7; day++) {
    const sorted = ranges
      .map((r, index) => ({ ...r, index }))
      .filter((r) => r.weekday === day)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    for (let i = 1; i < sorted.length; i++) {
      if (timeToMinutes(sorted[i]!.startTime) < timeToMinutes(sorted[i - 1]!.endTime)) {
        ctx.addIssue({
          code: "custom",
          message: "Los tramos de un mismo día no se pueden pisar.",
          path: [sorted[i]!.index, "startTime"],
        })
      }
    }
  }
})

export type WeeklyRangeValue = z.infer<typeof weeklyRangeInput>

export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Escribí un email válido." }))

/** Color de un profesional en la agenda (#rrggbb). */
export const colorInput = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, { error: "Elegí un color." })
  .nullable()
  .optional()
