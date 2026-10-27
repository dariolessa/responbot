/*
 * Montos en enteros de centésimos con su moneda (CLAUDE.md).
 */

/** 125000, "UYU" → "$ 1.250". Muestra decimales solo si los hay. */
export function formatMoney(cents: number, currency: string): string {
  const hasDecimals = cents % 100 !== 0
  try {
    return new Intl.NumberFormat("es-UY", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `${currency} ${(cents / 100).toFixed(hasDecimals ? 2 : 0)}`
  }
}

/**
 * Lo que escribe una persona → centésimos. Acepta "1250", "1.250", "1250,50",
 * "1.250,50" y "$ 1250". Devuelve null si no es un monto válido.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d.,]/g, "")
  if (!cleaned || !/\d/.test(cleaned)) return null

  let normalized: string
  const lastComma = cleaned.lastIndexOf(",")
  const lastDot = cleaned.lastIndexOf(".")
  if (lastComma > -1) {
    // La coma es el separador decimal (es-UY); los puntos son de miles.
    normalized = cleaned.slice(0, lastComma).replace(/[.,]/g, "") + "." + cleaned.slice(lastComma + 1)
  } else if (lastDot > -1 && cleaned.length - lastDot - 1 === 3) {
    // "1.250": punto de miles.
    normalized = cleaned.replace(/\./g, "")
  } else if (lastDot > -1) {
    normalized = cleaned.slice(0, lastDot).replace(/\./g, "") + "." + cleaned.slice(lastDot + 1)
  } else {
    normalized = cleaned
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/** Centésimos → texto editable en un input ("1250" o "1250,50"). */
export function centsToInput(cents: number): string {
  const units = Math.floor(cents / 100)
  const rest = cents % 100
  return rest === 0 ? String(units) : `${units},${String(rest).padStart(2, "0")}`
}
