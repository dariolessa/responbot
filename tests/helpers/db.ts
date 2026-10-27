import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"

import * as schema from "@/lib/db/schema"

/**
 * Postgres real en memoria (PGlite) con las mismas migraciones que producción,
 * incluida la extensión btree_gist y la exclusión de turnos superpuestos.
 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { btree_gist } })
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
  return { db, close: () => client.close() }
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"]
