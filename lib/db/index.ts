import "server-only"

import { Pool as NeonPool } from "@neondatabase/serverless"
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import { Pool as PgPool } from "pg"

import { env } from "@/lib/env"
import * as schema from "./schema"

/*
 * Cliente de Neon con el driver serverless (WebSocket), que soporta
 * transacciones interactivas: las necesita la creación de turnos.
 *
 * Con un Postgres local (localhost) usa node-postgres, para poder desarrollar
 * sin Neon. Ver docs/DECISIONS.md.
 *
 * No importes `db` desde pantallas o acciones: usá lib/auth/tenant.ts y
 * lib/db/scoped.ts, que filtran todo por business_id.
 */

function isLocal(url: string | undefined) {
  if (!url) return false
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

function createDb() {
  if (isLocal(env.DATABASE_URL)) {
    return drizzlePg({ client: new PgPool({ connectionString: env.DATABASE_URL }), schema })
  }
  return drizzleNeon({ client: new NeonPool({ connectionString: env.DATABASE_URL }), schema })
}

type Db = ReturnType<typeof createDb>

const globalForDb = globalThis as unknown as { db?: Db }

/** Instancia única (también entre recargas de `next dev`). */
export const db: Db = globalForDb.db ?? createDb()
if (process.env.NODE_ENV !== "production") globalForDb.db = db

export type { Db }
