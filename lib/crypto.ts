import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/*
 * Cifrado AES-256-GCM de tokens de terceros (docs/SPEC.md, "Seguridad"): los
 * tokens de WhatsApp y Mercado Pago se guardan cifrados con ENCRYPTION_KEY y
 * nunca llegan al navegador ni a los logs.
 *
 * Formato: "v1.<iv>.<tag>.<texto cifrado>", cada parte en base64url.
 */

const VERSION = "v1"

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64")
  if (key.length !== 32) throw new Error("crypto: la clave tiene que ser de 32 bytes")
  return key
}

export function encrypt(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keyFrom(base64Key), iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".")
}

export function decrypt(payload: string, base64Key: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("crypto: formato inválido")
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(base64Key), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}
