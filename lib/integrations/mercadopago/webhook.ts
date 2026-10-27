import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/*
 * Webhook de Mercado Pago (docs/SPEC.md): se valida la firma `x-signature`
 * y después se consulta el pago por API; nunca se confía solo en el cuerpo.
 *
 * Firma: x-signature = "ts=<ts>,v1=<hmac>"; el manifiesto es
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (sin los pares que no
 * vienen), con HMAC-SHA256 en hexadecimal y la clave secreta de la app.
 */

export const mpNotification = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).transform(String).optional(),
  data: z.object({ id: z.union([z.string(), z.number()]).transform(String) }).optional(),
})

export type MpNotification = z.infer<typeof mpNotification>

export function signatureManifest(input: { dataId: string | null; requestId: string | null; ts: string }) {
  let manifest = ""
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`
  if (input.requestId) manifest += `request-id:${input.requestId};`
  manifest += `ts:${input.ts};`
  return manifest
}

function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=")
      return [key?.trim() ?? "", rest.join("=").trim()]
    }),
  )
  return parts.ts && parts.v1 ? { ts: parts.ts, v1: parts.v1 } : null
}

export function verifyMpSignature(input: {
  header: string | null
  requestId: string | null
  dataId: string | null
  secret: string
}): boolean {
  if (!input.header) return false
  const parsed = parseSignatureHeader(input.header)
  if (!parsed) return false
  const expected = createHmac("sha256", input.secret)
    .update(signatureManifest({ dataId: input.dataId, requestId: input.requestId, ts: parsed.ts }))
    .digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(parsed.v1)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Firma de prueba (tests y desarrollo local). */
export function signMpNotification(input: { dataId: string; requestId: string; ts: string; secret: string }) {
  const v1 = createHmac("sha256", input.secret).update(signatureManifest(input)).digest("hex")
  return `ts=${input.ts},v1=${v1}`
}
