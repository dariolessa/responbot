import { openingHours, type Catalog } from "@/lib/bot/catalog"
import { templateFor } from "@/lib/bot/templates"
import { brand } from "@/lib/brand"
import type * as schema from "@/lib/db/schema"
import type { Anthropic } from "@/lib/integrations/anthropic/types"
import { formatMoney } from "@/lib/money"
import { formatDuration } from "@/lib/onboarding/templates"
import { formatZoned, toDateString, toTimeString } from "@/lib/time"

import { fixedRules } from "./rules"

/*
 * System prompt en dos bloques (docs/SPEC.md, "Anthropic"):
 *
 * 1. Fijo por negocio: plantilla del arquetipo, reglas, datos y catálogo. Lleva
 *    cache_control: mientras el negocio no cambie su configuración, se lee de
 *    la caché en cada mensaje.
 * 2. Variable: fecha y hora local, el cliente y sus turnos. Va después del
 *    punto de caché para no invalidarlo.
 */

const tones: Record<schema.BotSettings["tone"], string> = {
  informal: "Tono informal y cercano: tratá al cliente de vos (voseo rioplatense).",
  formal: "Tono formal y cordial: tratá al cliente de usted.",
}

export function fixedBlock(input: {
  business: schema.Business
  rules: schema.BookingRules | undefined
  settings: schema.BotSettings | undefined
  catalog: Catalog
  /** Para la demo pública: la web de Responbot, que el bot comparte si le preguntan. */
  demoUrl?: string | null
}): string {
  const { business, rules, settings, catalog } = input
  const template = templateFor(business.archetype)
  const assistantName = settings?.assistantName || "Asistente"

  const services = catalog.services.length
    ? catalog.services
        .map((s) => {
          const staff = s.staff.length
            ? s.staff
                .map((p) => {
                  const extra = [
                    p.price !== s.price ? formatMoney(p.price, catalog.currency) : null,
                    p.durationMinutes !== s.durationMinutes ? formatDuration(p.durationMinutes) : null,
                  ].filter(Boolean)
                  return extra.length ? `${p.name} (${extra.join(", ")})` : p.name
                })
                .join(", ")
            : "nadie asignado todavía (no se puede reservar)"
          const description = s.description ? ` ${s.description}` : ""
          return `- ${s.name} [id ${s.id}]: ${formatDuration(s.durationMinutes)}, ${s.priceLabel}.${description} Lo hace: ${staff}.`
        })
        .join("\n")
    : "- Todavía no hay servicios cargados."

  const staff = catalog.staff.length
    ? catalog.staff.map((p) => `- ${p.name} [id ${p.id}]`).join("\n")
    : "- Todavía no hay profesionales cargados."

  const hours = openingHours(catalog.staff)
    .map((d) => `- ${d.day}: ${d.hours}`)
    .join("\n")

  const faq = settings?.faq?.length
    ? settings.faq.map((f) => `- P: ${f.question}\n  R: ${f.answer}`).join("\n")
    : "- No hay preguntas frecuentes cargadas."

  const policies = rules
    ? [
        `- Anticipación mínima para reservar: ${formatDuration(rules.minNoticeMinutes)}.`,
        `- Se puede reservar hasta ${rules.maxDaysAhead} días hacia adelante.`,
        `- Cancelaciones y cambios: hasta ${rules.cancelHours} horas antes del turno.`,
      ].join("\n")
    : "- Sin políticas cargadas."

  return [
    template.role({ assistantName, businessName: business.name }),
    tones[settings?.tone ?? "informal"],
    fixedRules,
    template.guidance,
    settings?.welcomeMessage
      ? `# Bienvenida\n\nEn el primer mensaje de una conversación, saludá usando como base este texto del negocio: "${settings.welcomeMessage}"`
      : "",
    `# El negocio\n\n- Nombre: ${business.name}\n- Dirección: ${business.address || "no está cargada"}\n- Zona horaria: ${business.timezone}\n- Moneda: ${business.currency}`,
    `# Horario de atención\n\n${hours}`,
    `# Servicios\n\nUsá los id entre corchetes en las herramientas; nunca se los muestres al cliente.\n\n${services}`,
    `# Equipo\n\n${staff}`,
    `# Políticas\n\n${policies}`,
    `# Preguntas frecuentes\n\n${faq}`,
    business.isDemo ? demoBlock(input.demoUrl ?? null) : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function demoBlock(url: string | null): string {
  return [
    "# Demo",
    "",
    `Este negocio es la demo pública de ${brand.name}: quien escribe está probando cómo funciona el asistente. Atendelo igual que en un negocio real (consultas, precios, reservas, cambios y cancelaciones).`,
    "- Al confirmar un turno, aclarale en una frase que es de prueba y que se borra a la noche.",
    `- Si pregunta qué es esto o cómo tenerlo en su negocio, explicá en una o dos frases que ${brand.name} es un asistente de WhatsApp que responde, cotiza y reserva turnos con la agenda del negocio${url ? `, y pasale ${url}` : ""}.`,
    "- No derives a una persona salvo que lo pida: en la demo nadie del equipo responde.",
  ].join("\n")
}

export function contextBlock(input: {
  business: schema.Business
  customer: schema.Customer
  upcoming: { service: string; staff: string; startsAt: Date }[]
  now: Date
  canBook: boolean
  firstMessage: boolean
}): string {
  const { business, customer, upcoming, now } = input
  const tz = business.timezone
  const lines = [
    `# Ahora`,
    ``,
    `Hoy es ${formatZoned(now, tz, "EEEE d 'de' MMMM 'de' yyyy")} (${toDateString(now, tz)}), son las ${toTimeString(now, tz)}.`,
    ``,
    `# Cliente`,
    ``,
    customer.name ? `- Nombre: ${customer.name}` : "- Todavía no sabemos su nombre; si surge natural, preguntáselo.",
    customer.noShowCount > 0 ? `- Faltó ${customer.noShowCount} vez/veces sin avisar.` : null,
    upcoming.length
      ? `- Turnos próximos:\n${upcoming
          .map((b) => `  - ${b.service} con ${b.staff}, ${formatZoned(b.startsAt, tz, "EEEE d 'de' MMMM 'a las' HH:mm")}`)
          .join("\n")}`
      : "- No tiene turnos próximos.",
    input.firstMessage ? "\nEs el primer mensaje de esta conversación." : null,
    input.canBook
      ? null
      : "\nAhora el negocio no toma reservas por este medio: respondé consultas, y para reservar, mover o cancelar derivá a una persona.",
  ]
  return lines.filter((l) => l !== null).join("\n")
}

export function systemBlocks(fixed: string, context: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: fixed, cache_control: { type: "ephemeral" } },
    { type: "text", text: context },
  ]
}
