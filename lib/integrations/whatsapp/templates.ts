import type { TemplatePayload } from "./client"
import { graphRequest, GraphError, type GraphOptions } from "./graph"

/*
 * Plantillas de mensajes (docs/SPEC.md, "Ventana de 24 horas"). Fuera de la
 * ventana de servicio solo se puede escribir con plantillas aprobadas por
 * Meta. Se envían a revisión en la WABA de cada negocio al conectar WhatsApp
 * (y desde Configuración); las usan los recordatorios y avisos de la Fase 4.
 * Las que se suman después se mandan con "Enviar a revisión de Meta".
 */

export const TEMPLATE_LANGUAGE = "es_AR"

export type TemplateDefinition = {
  name: string
  category: "UTILITY" | "MARKETING"
  /** Qué es, en palabras del dueño (pantalla de Configuración). */
  label: string
  body: string
  /** Un ejemplo por variable, en orden; Meta lo exige para revisar. */
  example: string[]
  buttons?: string[]
}

export const templateDefinitions: TemplateDefinition[] = [
  {
    name: "recordatorio_turno",
    category: "UTILITY",
    label: "Recordatorio de turno",
    body: "Hola {{1}}, te recordamos tu turno de {{2}} con {{3}} el {{4}} a las {{5}} en {{6}}. ¿Nos confirmás?",
    example: ["Lucía", "Corte", "Ana", "martes 3 de noviembre", "10:30", "Bulevar Artigas 1234"],
    buttons: ["Confirmo", "Reprogramar", "Cancelar"],
  },
  {
    name: "recordatorio_corto",
    category: "UTILITY",
    label: "Recordatorio corto (el mismo día)",
    body: "Hola {{1}}, te esperamos hoy a las {{2}} para tu turno de {{3}} en {{4}}. Si no podés venir, avisanos por acá.",
    example: ["Lucía", "10:30", "Corte", "Bulevar Artigas 1234"],
  },
  {
    name: "confirmacion_turno",
    category: "UTILITY",
    label: "Confirmación de reserva",
    body: "¡Listo, {{1}}! Tu turno de {{2}} con {{3}} quedó reservado para el {{4}} a las {{5}}. Te esperamos en {{6}}.",
    example: ["Lucía", "Corte", "Ana", "martes 3 de noviembre", "10:30", "Bulevar Artigas 1234"],
  },
  {
    name: "turno_cancelado",
    category: "UTILITY",
    label: "Turno cancelado",
    body: "Hola {{1}}, tu turno de {{2}} del {{3}} a las {{4}} quedó cancelado. Si querés reservar otro horario, respondé este mensaje.",
    example: ["Lucía", "Corte", "martes 3 de noviembre", "10:30"],
  },
  {
    name: "lugar_liberado",
    category: "UTILITY",
    label: "Lugar liberado (lista de espera)",
    body: "Hola {{1}}, se liberó un lugar para {{2}} el {{3}} a las {{4}}. Si lo querés, tocá el botón y te lo reservamos; es para quien conteste primero.",
    example: ["Lucía", "Corte", "martes 3 de noviembre", "10:30"],
    buttons: ["Lo quiero"],
  },
  {
    name: "sena_pendiente",
    category: "UTILITY",
    label: "Link de pago de la seña",
    body: "Hola {{1}}, te guardamos el turno de {{2}} del {{3}} a las {{4}}. Para confirmarlo, pagá la seña de {{5}} acá: {{6}} . El lugar queda reservado hasta las {{7}}.",
    example: [
      "Lucía",
      "Corte",
      "martes 3 de noviembre",
      "10:30",
      "$ 300",
      "https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=123",
      "18:15",
    ],
  },
  {
    name: "retencion_vencida",
    category: "UTILITY",
    label: "Turno liberado por seña sin pagar",
    body: "Hola {{1}}, como no llegó la seña, se liberó el turno de {{2}} del {{3}} a las {{4}}. Si querés reservar otro horario, respondé este mensaje.",
    example: ["Lucía", "Corte", "martes 3 de noviembre", "10:30"],
  },
  {
    name: "sena_devuelta",
    category: "UTILITY",
    label: "Seña devuelta",
    body: "Hola {{1}}, te devolvimos la seña de {{2}} del turno de {{3}} del {{4}}. Según tu medio de pago, puede tardar unos días en verse.",
    example: ["Lucía", "$ 300", "Corte", "martes 3 de noviembre"],
  },
  {
    name: "lugar_tomado",
    category: "UTILITY",
    label: "Lugar ya tomado (lista de espera)",
    body: "Hola {{1}}, el lugar para {{2}} del {{3}} a las {{4}} ya lo tomó otra persona. Seguís en la lista de espera y te avisamos si se libera otro.",
    example: ["Lucía", "Corte", "martes 3 de noviembre", "10:30"],
  },
  {
    name: "reactivacion_cliente",
    category: "MARKETING",
    label: "Invitación a volver",
    body: "Hola {{1}}, ¿cómo andás? Ya pasó un tiempo desde tu último {{2}}. ¿Querés que te reservemos un turno con {{3}}?",
    example: ["Lucía", "corte", "Ana"],
    buttons: ["Sí, quiero", "Ahora no"],
  },
  {
    name: "resumen_diario_dueno",
    category: "UTILITY",
    label: "Resumen diario para el dueño",
    body: "Buen día, {{1}}. Hoy en {{2}} hay {{3}} turnos; el primero es a las {{4}}. Desde ayer el bot tomó {{5}} reservas nuevas.",
    example: ["Marcela", "Peluquería Sol", "8", "09:00", "3"],
  },
  {
    name: "aviso_derivacion_dueno",
    category: "UTILITY",
    label: "Aviso de conversación derivada",
    body: "Hola {{1}}, {{2}} necesita que alguien del equipo le responda por WhatsApp. Motivo: {{3}}. Entrá a Conversaciones para atenderlo.",
    example: ["Marcela", "Lucía", "quiere hablar con una persona"],
  },
  {
    name: "aviso_reserva_dueno",
    category: "UTILITY",
    label: "Aviso de reserva nueva para el equipo",
    body: "Hola {{1}}, hay una reserva nueva en {{2}}: {{3}} para {{4}} con {{5}}, el {{6}} a las {{7}}.",
    example: ["Marcela", "Peluquería Sol", "Lucía", "Corte", "Ana", "martes 3 de noviembre", "10:30"],
  },
  {
    name: "aviso_cambio_turno_dueno",
    category: "UTILITY",
    label: "Aviso de turno cancelado o movido para el equipo",
    body: "Hola {{1}}, en {{2}} {{3}} el turno de {{4}} para {{5}} con {{6}}, del {{7}} a las {{8}}.",
    example: ["Marcela", "Peluquería Sol", "se canceló", "Lucía", "Corte", "Ana", "martes 3 de noviembre", "10:30"],
  },
]

export type TemplateName =
  | "recordatorio_turno"
  | "recordatorio_corto"
  | "confirmacion_turno"
  | "turno_cancelado"
  | "lugar_liberado"
  | "sena_pendiente"
  | "retencion_vencida"
  | "sena_devuelta"
  | "lugar_tomado"
  | "reactivacion_cliente"
  | "resumen_diario_dueno"
  | "aviso_derivacion_dueno"
  | "aviso_reserva_dueno"
  | "aviso_cambio_turno_dueno"

export function templateByName(name: TemplateName): TemplateDefinition {
  const found = templateDefinitions.find((t) => t.name === name)
  if (!found) throw new Error(`whatsapp: no existe la plantilla ${name}`)
  return found
}

/** Meta no acepta variables vacías, con saltos de línea, tabulaciones ni más de 4 espacios seguidos. */
export function templateParam(value: string | null | undefined, fallback = "-"): string {
  const clean = (value ?? "").replace(/[\n\t\r]+/g, " ").replace(/ {2,}/g, " ").trim()
  return (clean || fallback).slice(0, 200)
}

/** Texto de la plantilla con las variables puestas (lo que se guarda en la conversación). */
export function fillTemplate(name: TemplateName, params: string[]): string {
  return templateByName(name).body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => templateParam(params[Number(n) - 1]))
}

/**
 * Plantilla lista para mandar. `buttonPayloads` va en el orden de los botones
 * de respuesta rápida: es lo que vuelve en el webhook cuando el cliente toca uno.
 */
export function templatePayload(name: TemplateName, params: string[], buttonPayloads: string[] = []): TemplatePayload {
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: params.map((text) => ({ type: "text", text: templateParam(text) })) },
  ]
  buttonPayloads.forEach((payload, index) => {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload }],
    })
  })
  return { name, language: { code: TEMPLATE_LANGUAGE }, components }
}

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | string

export type RemoteTemplate = { name: string; status: TemplateStatus; language: string; category?: string }

export function templateCreateBody(t: TemplateDefinition): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: t.body, example: { body_text: [t.example] } },
  ]
  if (t.buttons?.length) {
    components.push({ type: "BUTTONS", buttons: t.buttons.map((text) => ({ type: "QUICK_REPLY", text })) })
  }
  return { name: t.name, language: TEMPLATE_LANGUAGE, category: t.category, components }
}

export async function listTemplates(wabaId: string, options: GraphOptions): Promise<RemoteTemplate[]> {
  const result = await graphRequest<{ data?: RemoteTemplate[] }>(
    options,
    "GET",
    `${wabaId}/message_templates?fields=name,status,language,category&limit=200`,
  )
  return result.data ?? []
}

/**
 * Manda a revisión las plantillas que la WABA todavía no tiene. Devuelve los
 * nombres enviados y los que Meta rechazó al crearlas (con el motivo).
 */
export async function submitMissingTemplates(
  wabaId: string,
  options: GraphOptions,
): Promise<{ submitted: string[]; failed: { name: string; error: string }[] }> {
  const existing = new Set(
    (await listTemplates(wabaId, options))
      .filter((t) => t.language === TEMPLATE_LANGUAGE)
      .map((t) => t.name),
  )
  const submitted: string[] = []
  const failed: { name: string; error: string }[] = []
  for (const template of templateDefinitions) {
    if (existing.has(template.name)) continue
    try {
      await graphRequest(options, "POST", `${wabaId}/message_templates`, templateCreateBody(template))
      submitted.push(template.name)
    } catch (error) {
      if (!(error instanceof GraphError)) throw error
      failed.push({ name: template.name, error: error.message })
    }
  }
  return { submitted, failed }
}
