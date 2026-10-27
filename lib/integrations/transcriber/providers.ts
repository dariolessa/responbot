import type { Transcriber } from "./types"

/*
 * Proveedores de transcripción por API HTTP oficial. Se elige con
 * TRANSCRIBER_PROVIDER (openai o elevenlabs) y TRANSCRIBER_API_KEY.
 */

const extensions: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/webm": "webm",
}

function fileFor(audio: Uint8Array, mimeType: string): File {
  const base = mimeType.split(";")[0]!.trim()
  return new File([audio as Uint8Array<ArrayBuffer>], `audio.${extensions[base] ?? "ogg"}`, { type: base })
}

async function readText(response: Response, provider: string): Promise<string> {
  if (!response.ok) throw new Error(`${provider} respondió ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const json = (await response.json()) as { text?: string }
  return (json.text ?? "").trim()
}

export function openAiTranscriber(apiKey: string, doFetch: typeof fetch = fetch): Transcriber {
  return {
    name: "openai",
    async transcribe(audio, mimeType, lang = "es") {
      const form = new FormData()
      form.append("file", fileFor(audio, mimeType))
      form.append("model", "gpt-4o-mini-transcribe")
      form.append("language", lang)
      const response = await doFetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      })
      return readText(response, "OpenAI")
    },
  }
}

const elevenLabsLanguages: Record<string, string> = { es: "spa", en: "eng", pt: "por" }

export function elevenLabsTranscriber(apiKey: string, doFetch: typeof fetch = fetch): Transcriber {
  return {
    name: "elevenlabs",
    async transcribe(audio, mimeType, lang = "es") {
      const form = new FormData()
      form.append("file", fileFor(audio, mimeType))
      form.append("model_id", "scribe_v1")
      form.append("language_code", elevenLabsLanguages[lang] ?? lang)
      form.append("tag_audio_events", "false")
      const response = await doFetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(30_000),
      })
      return readText(response, "ElevenLabs")
    },
  }
}
