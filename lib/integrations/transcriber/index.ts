import "server-only"

import { env } from "@/lib/env"

import { elevenLabsTranscriber, openAiTranscriber } from "./providers"
import type { Transcriber } from "./types"

/** El transcriptor configurado, o null si faltan TRANSCRIBER_PROVIDER o TRANSCRIBER_API_KEY. */
export function configuredTranscriber(): Transcriber | null {
  if (!env.TRANSCRIBER_PROVIDER || !env.TRANSCRIBER_API_KEY) return null
  return env.TRANSCRIBER_PROVIDER === "elevenlabs"
    ? elevenLabsTranscriber(env.TRANSCRIBER_API_KEY)
    : openAiTranscriber(env.TRANSCRIBER_API_KEY)
}

export type { Transcriber }
