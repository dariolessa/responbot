/*
 * Duración de un audio sin decodificarlo. Las notas de voz de WhatsApp son
 * Ogg/Opus: la última página Ogg trae la posición en muestras a 48 kHz.
 * Para otros formatos se estima por tamaño (128 kbps, una cota generosa).
 */

const OPUS_RATE = 48_000
const FALLBACK_BYTES_PER_SECOND = 16_000

function lastOggGranule(data: Uint8Array): bigint | null {
  // Busca "OggS" desde el final; la posición de granule va en los bytes 6 a 13 (little endian).
  for (let i = data.length - 27; i >= 0; i--) {
    if (data[i] === 0x4f && data[i + 1] === 0x67 && data[i + 2] === 0x67 && data[i + 3] === 0x53) {
      let value = BigInt(0)
      for (let b = 7; b >= 0; b--) value = (value << BigInt(8)) | BigInt(data[i + 6 + b]!)
      return value
    }
  }
  return null
}

/** Segundos aproximados del audio. */
export function audioDurationSeconds(data: Uint8Array, mimeType: string): number {
  if (mimeType.includes("ogg") || mimeType.includes("opus")) {
    const granule = lastOggGranule(data)
    if (granule !== null && granule > BigInt(0)) return Number(granule) / OPUS_RATE
  }
  return data.byteLength / FALLBACK_BYTES_PER_SECOND
}
