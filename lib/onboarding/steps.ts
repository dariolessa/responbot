/*
 * Pasos del asistente de alta (docs/SPEC.md, "Asistente de alta del negocio").
 * Cada paso se guarda al avanzar y queda en businesses.onboarding_completed;
 * el panel muestra los pendientes hasta completar el alta.
 */

export type StepKey =
  | "business"
  | "services"
  | "team"
  | "rules"
  | "whatsapp"
  | "mercadopago"
  | "test_bot"

export type Step = {
  key: StepKey
  number: number
  title: string
  description: string
  href: string
  /** Los pasos de conexiones y del bot llegan en fases siguientes. */
  available: boolean
  optional?: boolean
}

export const steps: Step[] = [
  {
    key: "business",
    number: 1,
    title: "Datos del negocio",
    description: "Nombre, rubro, dirección, zona horaria y moneda.",
    href: "/onboarding",
    available: true,
  },
  {
    key: "services",
    number: 2,
    title: "Servicios",
    description: "Qué ofrecés, cuánto dura y cuánto sale.",
    href: "/onboarding/servicios",
    available: true,
  },
  {
    key: "team",
    number: 3,
    title: "Equipo y horarios",
    description: "Quién atiende, qué hace cada uno y en qué horario.",
    href: "/onboarding/equipo",
    available: true,
  },
  {
    key: "rules",
    number: 4,
    title: "Reglas de reserva",
    description: "Anticipación, días hacia adelante, cancelaciones y seña.",
    href: "/onboarding/reglas",
    available: true,
  },
  {
    key: "whatsapp",
    number: 5,
    title: "Conectar WhatsApp",
    description: "Tu número para que el bot responda.",
    href: "/app/configuracion",
    available: false,
  },
  {
    key: "mercadopago",
    number: 6,
    title: "Conectar Mercado Pago",
    description: "Para cobrar señas.",
    href: "/app/configuracion",
    available: false,
    optional: true,
  },
  {
    key: "test_bot",
    number: 7,
    title: "Probar el bot",
    description: "Un chat de prueba con tu asistente.",
    href: "/app/bot",
    available: false,
  },
]

export const TOTAL_STEPS = steps.length

export function stepByKey(key: StepKey): Step {
  return steps.find((s) => s.key === key)!
}

/** Pasos disponibles que faltan, en orden. */
export function pendingSteps(completed: readonly string[]): Step[] {
  const done = new Set(completed)
  return steps.filter((s) => s.available && !done.has(s.key))
}

/** A dónde sigue el asistente después de un paso. */
export function nextStepHref(after: StepKey): string {
  const index = steps.findIndex((s) => s.key === after)
  const next = steps.slice(index + 1).find((s) => s.available)
  return next?.href ?? "/onboarding/listo"
}

/** Agrega un paso a la lista de completados, sin repetir. */
export function withCompleted(completed: readonly string[], key: StepKey): string[] {
  return completed.includes(key) ? [...completed] : [...completed, key]
}
