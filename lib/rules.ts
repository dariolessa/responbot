import { z } from "zod"

import { centsToInput, parseMoney } from "@/lib/money"

/*
 * Reglas de reserva (booking_rules, docs/SPEC.md "Asistente de alta" paso 4).
 * Las opciones son las que se ofrecen en los formularios.
 */

export const minNoticeOptions = [
  { value: 0, label: "Sin anticipación" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 120, label: "2 horas" },
  { value: 180, label: "3 horas" },
  { value: 360, label: "6 horas" },
  { value: 720, label: "12 horas" },
  { value: 1440, label: "1 día" },
  { value: 2880, label: "2 días" },
]

export const maxDaysAheadOptions = [
  { value: 7, label: "1 semana" },
  { value: 14, label: "2 semanas" },
  { value: 30, label: "1 mes" },
  { value: 60, label: "2 meses" },
  { value: 90, label: "3 meses" },
  { value: 180, label: "6 meses" },
]

export const bufferOptions = [
  { value: 0, label: "Sin descanso" },
  { value: 5, label: "5 minutos" },
  { value: 10, label: "10 minutos" },
  { value: 15, label: "15 minutos" },
  { value: 20, label: "20 minutos" },
  { value: 30, label: "30 minutos" },
]

export const slotStepOptions = [
  { value: 10, label: "Cada 10 minutos" },
  { value: 15, label: "Cada 15 minutos" },
  { value: 20, label: "Cada 20 minutos" },
  { value: 30, label: "Cada 30 minutos" },
  { value: 60, label: "Cada hora" },
]

export const cancelHoursOptions = [
  { value: 0, label: "Hasta el momento del turno" },
  { value: 2, label: "Hasta 2 horas antes" },
  { value: 4, label: "Hasta 4 horas antes" },
  { value: 12, label: "Hasta 12 horas antes" },
  { value: 24, label: "Hasta 24 horas antes" },
  { value: 48, label: "Hasta 48 horas antes" },
  { value: 72, label: "Hasta 72 horas antes" },
]

const oneOf = (options: { value: number }[], message: string) =>
  z.coerce.number().refine((v) => options.some((o) => o.value === v), { error: message })

export const rulesInput = z
  .object({
    minNoticeMinutes: oneOf(minNoticeOptions, "Elegí la anticipación mínima."),
    maxDaysAhead: oneOf(maxDaysAheadOptions, "Elegí hasta cuándo se puede reservar."),
    bufferMinutes: oneOf(bufferOptions, "Elegí el descanso entre turnos."),
    slotStepMinutes: oneOf(slotStepOptions, "Elegí cada cuánto se ofrecen horarios."),
    cancelHours: oneOf(cancelHoursOptions, "Elegí hasta cuándo se puede cancelar."),
    depositMode: z.enum(["none", "fixed", "percent"]),
    depositValue: z.string().trim().optional(),
  })
  .transform((v, ctx) => {
    let depositValue = 0
    if (v.depositMode === "fixed") {
      const cents = parseMoney(v.depositValue ?? "")
      if (!cents) {
        ctx.addIssue({ code: "custom", message: "Escribí el monto de la seña.", path: ["depositValue"] })
        return z.NEVER
      }
      depositValue = cents
    } else if (v.depositMode === "percent") {
      const percent = Number((v.depositValue ?? "").replace(",", "."))
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
        ctx.addIssue({
          code: "custom",
          message: "Escribí un porcentaje entre 1 y 100.",
          path: ["depositValue"],
        })
        return z.NEVER
      }
      depositValue = percent
    }
    return { ...v, depositValue }
  })

export type RulesFormValues = z.input<typeof rulesInput>

/** Valores del formulario a partir de la fila de booking_rules. */
export function rulesToForm(rules: {
  minNoticeMinutes: number
  maxDaysAhead: number
  bufferMinutes: number
  slotStepMinutes: number
  cancelHours: number
  depositMode: "none" | "fixed" | "percent"
  depositValue: number
}): RulesFormValues {
  return {
    minNoticeMinutes: rules.minNoticeMinutes,
    maxDaysAhead: rules.maxDaysAhead,
    bufferMinutes: rules.bufferMinutes,
    slotStepMinutes: rules.slotStepMinutes,
    cancelHours: rules.cancelHours,
    depositMode: rules.depositMode,
    depositValue:
      rules.depositMode === "fixed"
        ? centsToInput(rules.depositValue)
        : rules.depositMode === "percent"
          ? String(rules.depositValue)
          : "",
  }
}

export const defaultRules = {
  minNoticeMinutes: 60,
  maxDaysAhead: 60,
  bufferMinutes: 0,
  slotStepMinutes: 15,
  cancelHours: 24,
  depositMode: "none" as const,
  depositValue: 0,
}
