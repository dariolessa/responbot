/*
 * Planes y límites (docs/SPEC.md, "Planes y facturación"). Es el único lugar
 * donde viven: las pantallas, el bot y los crons preguntan acá qué incluye el
 * plan del negocio. Los precios son una hipótesis a validar con los pilotos;
 * el precio real lo cobra Stripe (STRIPE_PRICE_*), estos montos son los que se
 * muestran en la landing y en Facturación.
 *
 * Sin dependencias del servidor: lo usan también la landing y componentes.
 */

export const paidPlanIds = ["basic", "pro", "team"] as const
export type PaidPlanId = (typeof paidPlanIds)[number]
export type PlanId = PaidPlanId | "trial"

export const featureKeys = [
  "deposits",
  "waitlist",
  "customerProfiles",
  "stats",
  "reactivation",
  "weeklySummary",
  "prioritySupport",
] as const
export type Feature = (typeof featureKeys)[number]

export const featureLabels: Record<Feature, string> = {
  deposits: "Señas con Mercado Pago",
  waitlist: "Lista de espera",
  customerProfiles: "Ficha de clientes",
  stats: "Estadísticas",
  reactivation: "Reactivación automática de clientes",
  weeklySummary: "Resumen semanal por correo",
  prioritySupport: "Soporte prioritario",
}

export type PlanDefinition = {
  id: PlanId
  name: string
  /** Para quién es, en una frase. */
  audience: string
  /** Precio mensual en centésimos de USD (solo para mostrar). */
  monthlyPriceUsd: number
  /** Profesionales activos en la agenda; null = sin límite. */
  maxStaff: number | null
  /** Conversaciones de WhatsApp por mes (ventanas de 24 horas abiertas por un cliente). */
  monthlyConversations: number
  /** Plantillas de WhatsApp por mes (recordatorios y avisos fuera de la ventana). */
  monthlyTemplates: number
  features: Record<Feature, boolean>
  /** Lo que se lista en la tarjeta del plan, además de los límites. */
  highlights: string[]
}

const none: Record<Feature, boolean> = {
  deposits: false,
  waitlist: false,
  customerProfiles: false,
  stats: false,
  reactivation: false,
  weeklySummary: false,
  prioritySupport: false,
}

export const plans: Record<PaidPlanId, PlanDefinition> = {
  basic: {
    id: "basic",
    name: "Básico",
    audience: "Profesional independiente",
    monthlyPriceUsd: 1900,
    maxStaff: 1,
    monthlyConversations: 300,
    monthlyTemplates: 300,
    features: none,
    highlights: ["Bot de WhatsApp y agenda", "Recordatorios automáticos", "Pedido de reseñas"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    audience: "Local con equipo chico",
    monthlyPriceUsd: 3900,
    maxStaff: 5,
    monthlyConversations: 1000,
    monthlyTemplates: 1000,
    features: { ...none, deposits: true, waitlist: true, customerProfiles: true, stats: true },
    highlights: ["Todo lo del Básico", "Señas con Mercado Pago", "Lista de espera", "Ficha de clientes", "Estadísticas"],
  },
  team: {
    id: "team",
    name: "Equipo",
    audience: "Locales grandes o varias sucursales",
    monthlyPriceUsd: 7900,
    maxStaff: null,
    monthlyConversations: 3000,
    monthlyTemplates: 3000,
    features: {
      deposits: true,
      waitlist: true,
      customerProfiles: true,
      stats: true,
      reactivation: true,
      weeklySummary: true,
      prioritySupport: true,
    },
    highlights: ["Todo lo del Pro", "Reactivación automática", "Resumen semanal", "Soporte prioritario"],
  },
}

/** La prueba de 14 días muestra todo (como Equipo) con los límites del Pro. */
export const trialPlan: PlanDefinition = {
  ...plans.team,
  id: "trial",
  name: "Prueba",
  audience: "14 días para probar todo",
  monthlyPriceUsd: 0,
  monthlyConversations: plans.pro.monthlyConversations,
  monthlyTemplates: plans.pro.monthlyTemplates,
  highlights: [],
}

export const TRIAL_DAYS = 14
/** Días de gracia después de un cobro fallido antes de pasar a solo lectura. */
export const GRACE_DAYS = 7
/** Porcentajes del límite mensual en los que se avisa al dueño. */
export const USAGE_ALERT_THRESHOLDS = [80, 100] as const

export function planDefinition(id: PlanId): PlanDefinition {
  return id === "trial" ? trialPlan : plans[id]
}

export function isPaidPlan(value: string): value is PaidPlanId {
  return (paidPlanIds as readonly string[]).includes(value)
}

/** Plan más barato que incluye la función (para el "pasate a…"). */
export function cheapestPlanWith(feature: Feature): PlanDefinition {
  return paidPlanIds.map((id) => plans[id]).find((p) => p.features[feature]) ?? plans.team
}

/** Plan más barato con lugar para esa cantidad de profesionales. */
export function cheapestPlanForStaff(count: number): PlanDefinition {
  return paidPlanIds.map((id) => plans[id]).find((p) => p.maxStaff === null || p.maxStaff >= count) ?? plans.team
}

/** "US$ 39". */
export function formatUsd(cents: number): string {
  return `US$ ${(cents / 100).toLocaleString("es-UY", { maximumFractionDigits: 2 })}`
}
