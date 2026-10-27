import type Anthropic from "@anthropic-ai/sdk"

/*
 * Lo mínimo que el motor del bot necesita de un modelo: un pedido de la API
 * de Messages (sin modelo ni parámetros) y su respuesta. Lo implementan el
 * cliente real (client.ts) y los modelos simulados de los tests.
 */

export type BotRequest = {
  system: Anthropic.Beta.BetaTextBlockParam[]
  tools: Anthropic.Beta.BetaTool[]
  messages: Anthropic.Beta.BetaMessageParam[]
}

export type BotModel = {
  name: string
  create(
    request: BotRequest,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Anthropic.Beta.BetaMessage>
}

export type { Anthropic }

/** Describe una imagen que mandó un cliente (por ejemplo, un diseño de uñas) en una o dos frases. */
export type ImageDescriber = {
  describe(image: Uint8Array, mimeType: string): Promise<string>
}

/** Pedido de datos estructurados: el modelo responde llamando a una única herramienta. */
export type StructuredModel = {
  run(request: {
    system: string
    prompt: string
    tool: { name: string; description: string; input_schema: Anthropic.Tool.InputSchema }
  }): Promise<unknown>
}
