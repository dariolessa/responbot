/*
 * Teléfonos de clientes en E.164 (customers.phone_e164), que es como llegan
 * por WhatsApp. En el panel la gente escribe "099 123 456"; se completa con el
 * código del país del negocio, que se deduce de su zona horaria.
 */

const callingCodeByTimezone: Record<string, string> = {
  "America/Montevideo": "598",
  "America/Argentina/Buenos_Aires": "54",
  "America/Sao_Paulo": "55",
  "America/Asuncion": "595",
  "America/Santiago": "56",
  "America/Lima": "51",
  "America/Bogota": "57",
  "America/Mexico_City": "52",
  "Europe/Madrid": "34",
}

export function callingCodeFor(timezone: string): string {
  return callingCodeByTimezone[timezone] ?? "598"
}

/**
 * Normaliza a E.164 ("+59899123456"). Devuelve null si no parece un número.
 *
 * - "+598 99 123 456" o "00598 99…" → se respeta el país.
 * - "099 123 456" → se saca el 0 inicial y se agrega el país del negocio.
 * - "99123456" → se agrega el país del negocio.
 */
export function normalizePhone(input: string, timezone: string): string | null {
  const trimmed = input.trim()
  let digits = trimmed.replace(/\D/g, "")
  if (!digits) return null

  let international: string
  if (trimmed.startsWith("+")) {
    international = digits
  } else if (digits.startsWith("00")) {
    international = digits.slice(2)
  } else {
    const code = callingCodeFor(timezone)
    digits = digits.replace(/^0+/, "")
    international = digits.startsWith(code) && digits.length > code.length + 7 ? digits : code + digits
  }

  // E.164: hasta 15 dígitos; un número real tiene al menos 8.
  if (international.length < 8 || international.length > 15) return null
  return `+${international}`
}

function groupDigits(rest: string): string {
  const sizes = rest.length === 8 ? [2, 3, 3] : rest.length === 10 ? [2, 4, 4] : [3, 3, 3, 3, 3]
  const out: string[] = []
  let i = 0
  for (const size of sizes) {
    if (i >= rest.length) break
    out.push(rest.slice(i, i + size))
    i += size
  }
  if (i < rest.length) out.push(rest.slice(i))
  return out.join(" ")
}

/** "+59899123456" → "+598 99 123 456" (agrupado para leer, sin pretensión de exactitud). */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  for (const code of new Set(Object.values(callingCodeByTimezone))) {
    if (digits.startsWith(code)) {
      const rest = digits.slice(code.length)
      return `+${code} ${groupDigits(rest)}`
    }
  }
  return e164
}
