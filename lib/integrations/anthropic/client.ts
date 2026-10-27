import "server-only"

import Anthropic from "@anthropic-ai/sdk"

import { env } from "@/lib/env"

import type { BotModel, BotRequest, ImageDescriber, StructuredModel } from "./types"

/*
 * Cliente de Claude para el bot (docs/SPEC.md, "Anthropic"). El motor recibe
 * un BotModel, así los tests le pasan uno simulado y nada más importa el SDK.
 */

/** Modelo de conversación del SPEC. */
export const CHAT_MODEL = "claude-sonnet-5-5"
/** Modelo para tareas cortas (describir imágenes). */
export const SHORT_TASK_MODEL = "claude-haiku-5-5"

const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const

export function isAnthropicConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

let client: Anthropic | undefined

export function anthropicModel(): BotModel {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY: el bot necesita la clave de Anthropic.")
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })
  const anthropic = client

  return {
    name: CHAT_MODEL,
    async create(request: BotRequest, options) {
      return anthropic.beta.messages.create(
        {
          model: CHAT_MODEL,
          max_tokens: 16000,
          // Chat corto con herramientas: esfuerzo bajo para responder rápido.
          output_config: { effort: "low" },
          // Si un clasificador rechaza el pedido, la API reintenta con el modelo recomendado.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: request.system,
          tools: request.tools,
          messages: request.messages,
        },
        { timeout: options?.timeoutMs, signal: options?.signal },
      )
    },
  }
}

/** Describe imágenes de clientes con el modelo de tareas cortas. */
export function anthropicDescriber(): ImageDescriber {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY: el bot necesita la clave de Anthropic.")
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })
  const anthropic = client

  return {
    async describe(image, mimeType) {
      const mediaType = imageTypes.find((t) => t === mimeType)
      if (!mediaType) throw new Error(`Formato de imagen no soportado: ${mimeType}`)
      const response = await anthropic.messages.create(
        {
          model: SHORT_TASK_MODEL,
          max_tokens: 300,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: Buffer.from(image).toString("base64") },
                },
                {
                  type: "text",
                  text: "Un cliente le mandó esta imagen a un negocio de servicios con turno (peluquería, uñas, estética). Describila en español en una o dos frases, con lo que sirva para atenderlo (estilo, largo, colores, diseño). Si tiene texto, transcribilo. Solo la descripción.",
                },
              ],
            },
          ],
        },
        { timeout: 20_000 },
      )
      return response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join(" ")
        .trim()
    },
  }
}

/** Extracción de datos con el modelo de tareas cortas (importador del catálogo). */
export function anthropicStructured(): StructuredModel {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY: el importador del catálogo necesita la clave de Anthropic.")
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })
  const anthropic = client

  return {
    async run({ system, prompt, tool }) {
      const response = await anthropic.messages.create(
        {
          model: SHORT_TASK_MODEL,
          max_tokens: 8000,
          system,
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
          messages: [{ role: "user", content: prompt }],
        },
        { timeout: 60_000 },
      )
      const call = response.content.find((b) => b.type === "tool_use")
      return call?.type === "tool_use" ? call.input : null
    },
  }
}
