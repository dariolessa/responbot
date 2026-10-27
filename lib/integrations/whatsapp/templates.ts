import { graphRequest, GraphError, type GraphOptions } from "./graph"

/*
 * Plantillas de mensajes (docs/SPEC.md, "Ventana de 24 horas"). Fuera de la
 * ventana de servicio solo se puede escribir con plantillas aprobadas por
 * Meta. Se envían a revisión en la WABA de cada negocio al conectar WhatsApp
 * (y desde Configuración); las usan los recordatorios y avisos de la Fase 4.
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
]

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
