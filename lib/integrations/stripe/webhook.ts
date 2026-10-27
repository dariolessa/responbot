import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/*
 * Webhook de Stripe (docs/SPEC.md): se valida el encabezado `Stripe-Signature`
 * antes de procesar. Formato: "t=<segundos>,v1=<hmac>[,v1=…]", con
 * HMAC-SHA256 en hexadecimal de "<t>.<cuerpo crudo>" y el secreto del
 * endpoint (whsec_…). Se rechazan firmas de más de 5 minutos.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300

export const stripeEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
})

export type StripeEvent = z.infer<typeof stripeEvent>

function sign(payload: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")
}

export function verifyStripeSignature(input: {
  payload: string
  header: string | null
  secret: string
  now?: Date
}): boolean {
  if (!input.header) return false
  let timestamp: string | null = null
  const signatures: string[] = []
  for (const part of input.header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim())
    if (key === "t" && value) timestamp = value
    if (key === "v1" && value) signatures.push(value)
  }
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = Buffer.from(sign(input.payload, timestamp, input.secret))
  return signatures.some((candidate) => {
    const b = Buffer.from(candidate)
    return b.length === expected.length && timingSafeEqual(expected, b)
  })
}

/** Firma de prueba (tests y desarrollo local). */
export function signStripePayload(payload: string, secret: string, now: Date = new Date()): string {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return `t=${timestamp},v1=${sign(payload, timestamp, secret)}`
}
