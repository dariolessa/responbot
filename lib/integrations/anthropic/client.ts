import "server-only"

import Anthropic from "@anthropic-ai/sdk"

import { env } from "@/lib/env"

import type { BotModel, BotRequest } from "./types"

/*
 * Cliente de Claude para el bot (docs/SPEC.md, "Anthropic"). El motor recibe
 * un BotModel, así los tests le pasan uno simulado y nada más importa el SDK.
 */

/** Modelo de conversación del SPEC. */
export const CHAT_MODEL = "claude-sonnet-5-5"

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
