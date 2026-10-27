import { createHmac, timingSafeEqual } from "node:crypto"

/*
 * signed_request de Meta (callback de eliminación de datos): dos partes en
 * base64url separadas por un punto, la firma HMAC-SHA256 del payload con el
 * app secret y el payload JSON.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): { user_id?: string } | null {
  const [signature, payload] = signedRequest.split(".")
  if (!signature || !payload) return null
  const expected = createHmac("sha256", appSecret).update(payload).digest()
  const given = Buffer.from(signature, "base64url")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { algorithm?: string; user_id?: string }
    return data.algorithm?.toUpperCase() === "HMAC-SHA256" ? data : null
  } catch {
    return null
  }
}
