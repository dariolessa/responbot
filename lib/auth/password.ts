import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

/*
 * Contraseñas para las cuentas de prueba creadas por script (la de los
 * revisores de Meta). Los usuarios normales entran con Google o con enlace
 * mágico; nadie puede ponerse una contraseña desde la web.
 *
 * Formato guardado en users.password_hash: "scrypt$<sal base64url>$<hash base64url>".
 */

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>
const KEY_LENGTH = 64

export const MIN_PASSWORD_LENGTH = 12

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return ["scrypt", salt.toString("base64url"), hash.toString("base64url")].join("$")
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, saltText, hashText] = (stored ?? "").split("$")
  if (scheme !== "scrypt" || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, "base64url")
  if (expected.length === 0) return false
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
