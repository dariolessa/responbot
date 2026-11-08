import { randomBytes } from "node:crypto"

import { sql } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { AnyDb } from "@/lib/db/scoped"

import { hashPassword, verifyPassword } from "./password"

/*
 * Ingreso con email y contraseña para las cuentas de prueba (revisores de
 * Meta). Auth.js no deja usar el proveedor de credenciales con sesiones en
 * base, así que acá se crea la misma fila de `sessions` que crearía Auth.js y
 * la acción pone la misma cookie: desde ahí la sesión es una más (se cierra
 * igual, vence igual y la valida `auth()`).
 */

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** Hash de relleno para que un email sin contraseña tarde lo mismo que una contraseña mal puesta. */
let dummyHash: Promise<string> | null = null

export async function createPasswordSession(
  db: AnyDb,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<{ sessionToken: string; expires: Date } | null> {
  const [user] = await db
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1)

  if (!user?.passwordHash) {
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"))
    await verifyPassword(password, await dummyHash)
    return null
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null

  const sessionToken = randomBytes(32).toString("hex")
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
  await db.insert(schema.sessions).values({ sessionToken, userId: user.id, expires })
  return { sessionToken, expires }
}
