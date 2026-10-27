import { z } from "zod"

import type { Actor } from "@/lib/booking/create"
import type * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { Anthropic } from "@/lib/integrations/anthropic/types"

/*
 * Herramientas del bot (docs/SPEC.md, "Herramientas del bot"). Cada una tiene
 * un esquema Zod para su entrada: el modelo la ve como JSON Schema y el motor
 * valida lo que llega antes de ejecutarla. Los datos salen siempre de la base.
 */

export type BotChannel = "whatsapp" | "test_chat"

export type ToolContext = {
  scoped: ScopedDb
  business: schema.Business
  rules: schema.BookingRules | undefined
  settings: schema.BotSettings | undefined
  /** Se actualiza si el cliente dice su nombre durante la conversación. */
  customer: schema.Customer
  conversation: schema.Conversation
  channel: BotChannel
  now: Date
  /** false si el negocio no puede tomar reservas (prueba vencida): solo consultas. */
  canBook: boolean
  /** Opciones para tocar que acompañan la respuesta (herramienta show_choices). */
  choices: schema.MessageChoices | null
  /** Fichas del catálogo que se mandan antes de la respuesta (send_catalog_items). */
  cards: string[]
}

/** Error que se devuelve al modelo como resultado de la herramienta (is_error). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolError"
  }
}

export type ToolOutput = Record<string, unknown>

export type BotTool<S extends z.ZodType = z.ZodType> = {
  name: string
  description: string
  input: S
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>
}

export function defineTool<S extends z.ZodType>(tool: BotTool<S>): BotTool<S> {
  return tool
}

/** Definición que se manda a la API de Messages. */
export function toApiTool(tool: BotTool): Anthropic.Beta.BetaTool {
  const inputSchema = z.toJSONSchema(tool.input) as Record<string, unknown>
  delete inputSchema.$schema
  return {
    name: tool.name,
    description: tool.description,
    input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }
}

export function botActor(ctx: ToolContext): Actor {
  return { type: "bot", id: null, channel: ctx.channel === "whatsapp" ? "whatsapp" : "panel" }
}

export function bookingSource(ctx: ToolContext) {
  return ctx.channel === "whatsapp" ? ("whatsapp" as const) : ("test_chat" as const)
}

/** Campos comunes en los esquemas. */
export const idField = (what: string) => z.uuid({ error: `Falta ${what} (un id de la lista).` })
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "La fecha va como AAAA-MM-DD." })
export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "La hora va como HH:mm (24 horas)." })
