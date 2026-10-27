import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/*
 * Webhook de Resend (rebotes y quejas). Resend firma con Svix: HMAC-SHA256 de
 * "<svix-id>.<svix-timestamp>.<cuerpo>" con el secreto `whsec_…` en base64,
 * y manda una o más firmas `v1,<base64>` en `svix-signature`.
 */

const TOLERANCE_SECONDS = 5 * 60

export function signResendBody(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")
}

export function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(now.getTime() / 1000 - seconds) > TOLERANCE_SECONDS) return false
  const expected = Buffer.from(signResendBody(secret, id, timestamp, body))
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",")
    if (version !== "v1" || !value) return false
    const given = Buffer.from(value)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

export const resendEvent = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z.object({ to: z.union([z.array(z.string()), z.string()]).optional() }).loose(),
})

/** Direcciones a las que no hay que escribir más (rebote o queja); vacío para otros eventos. */
export function undeliverableAddresses(event: z.infer<typeof resendEvent>): string[] {
  if (event.type !== "email.bounced" && event.type !== "email.complained") return []
  const to = event.data.to ?? []
  return (Array.isArray(to) ? to : [to]).map((a) => a.trim().toLowerCase()).filter(Boolean)
}
