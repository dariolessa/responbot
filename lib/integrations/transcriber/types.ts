/*
 * Transcripción de audios (docs/SPEC.md, "Transcripción de audio"): una
 * interfaz con proveedores intercambiables por variable de entorno.
 */

export type Transcriber = {
  name: string
  transcribe(audio: Uint8Array, mimeType: string, lang?: string): Promise<string>
}

/** Audios más largos no se transcriben: el bot pide que lo escriba o lo resuma. */
export const MAX_AUDIO_SECONDS = 120
