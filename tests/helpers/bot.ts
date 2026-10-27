import type { BotModel, BotRequest, Anthropic } from "@/lib/integrations/anthropic/types"
import { createService, createStaff } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { forBusiness, forUser, type ScopedDb } from "@/lib/db/scoped"

import type { TestDb } from "./db"

/*
 * Negocio de prueba para el bot y un modelo simulado que sigue un guion.
 */

export const TZ = "America/Montevideo"

export async function seedSalon(db: TestDb, slug: string) {
  const [owner] = await db.insert(schema.users).values({ email: `${slug}@example.com` }).returning()
  const business = await forUser(db, owner!.id).createBusiness({
    name: "Peluquería Sol",
    slug,
    archetype: "services",
    timezone: TZ,
    currency: "UYU",
    address: "Bulevar Artigas 1234",
    trialEndsAt: new Date("2026-12-31T00:00:00Z"),
  })
  const scoped = forBusiness(db, business.id)
  const corte = await createService(scoped, {
    name: "Corte",
    description: "Lavado y corte",
    durationMinutes: 30,
    price: 60000,
  })
  const color = await createService(scoped, {
    name: "Color",
    description: null,
    durationMinutes: 90,
    price: 180000,
  })
  // Lunes a sábado, 9 a 13 y 15 a 19.
  const hours = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, startTime: "09:00", endTime: "13:00" },
    { weekday, startTime: "15:00", endTime: "19:00" },
  ])
  const ana = await createStaff(scoped, { name: "Ana", serviceIds: [corte.id, color.id], hours })
  const beto = await createStaff(scoped, { name: "Beto", serviceIds: [corte.id], hours })
  return { owner: owner!, business, scoped, corte, color, ana, beto }
}

export type Step =
  | { tool: string; input: Record<string, unknown> }
  | { tools: { name: string; input: Record<string, unknown> }[] }
  | { text: string }

function message(
  content: Anthropic.Beta.BetaContentBlock[],
  stop: Anthropic.Beta.BetaMessage["stop_reason"],
): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Beta.BetaMessage
}

let toolCounter = 0

/**
 * Modelo simulado: cada llamada devuelve el próximo paso del guion. Guarda
 * los pedidos para revisar qué recibió (system, historial, resultados).
 */
export function scriptedModel(steps: (Step | ((request: BotRequest) => Step))[]) {
  const requests: BotRequest[] = []
  const model: BotModel & { requests: BotRequest[] } = {
    name: "fake",
    requests,
    async create(request) {
      // Copia: el motor sigue agregando mensajes al mismo arreglo.
      requests.push({ ...request, messages: [...request.messages] })
      const next = steps[requests.length - 1]
      if (!next) throw new Error("el guion se terminó")
      const step = typeof next === "function" ? next(request) : next
      if ("text" in step) return message([{ type: "text", text: step.text, citations: null }] as never, "end_turn")
      const calls = "tools" in step ? step.tools : [{ name: step.tool, input: step.input }]
      return message(
        calls.map((c) => ({ type: "tool_use", id: `toolu_${++toolCounter}`, name: c.name, input: c.input })) as never,
        "tool_use",
      )
    },
  }
  return model
}

/** Resultado (ya parseado) de la última herramienta que recibió el modelo. */
export function lastToolResult(request: BotRequest): { content: unknown; isError: boolean } {
  const last = request.messages.at(-1)
  const blocks = Array.isArray(last?.content) ? last.content : []
  const result = blocks.findLast((b) => b.type === "tool_result") as
    | Anthropic.Beta.BetaToolResultBlockParam
    | undefined
  return { content: JSON.parse(String(result?.content ?? "null")), isError: Boolean(result?.is_error) }
}

export type { ScopedDb }
