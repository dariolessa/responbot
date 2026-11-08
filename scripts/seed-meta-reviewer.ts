/*
 * Crea o actualiza la cuenta de prueba de los revisores de Meta (App Review).
 *
 *   META_REVIEWER_PASSWORD='…' pnpm seed:reviewer
 *
 * Lee DATABASE_URL y META_REVIEWER_PASSWORD del entorno o de .env.local. Es
 * idempotente: se puede correr las veces que haga falta (por ejemplo, para
 * cambiar la contraseña o renovar los turnos de ejemplo). Ver
 * lib/pilots/reviewer.ts y docs/META-APP-REVIEW.md.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })

async function main() {
  const url = process.env.DATABASE_URL
  const password = process.env.META_REVIEWER_PASSWORD
  if (!url) throw new Error("Falta DATABASE_URL.")
  if (!password) throw new Error("Falta META_REVIEWER_PASSWORD (la contraseña de la cuenta de los revisores).")

  const { seedMetaReviewer, REVIEWER_EMAIL } = await import("../lib/pilots/reviewer")
  const schema = await import("../lib/db/schema")
  const host = new URL(url).hostname
  const local = ["localhost", "127.0.0.1", "::1"].includes(host)

  let close: () => Promise<void>
  let result: Awaited<ReturnType<typeof seedMetaReviewer>>
  if (local) {
    const { Pool } = await import("pg")
    const { drizzle } = await import("drizzle-orm/node-postgres")
    const pool = new Pool({ connectionString: url })
    close = () => pool.end()
    result = await seedMetaReviewer(drizzle({ client: pool, schema }), { password })
  } else {
    const { Pool } = await import("@neondatabase/serverless")
    const { drizzle } = await import("drizzle-orm/neon-serverless")
    const pool = new Pool({ connectionString: url })
    close = () => pool.end()
    result = await seedMetaReviewer(drizzle({ client: pool, schema }), { password })
  }
  await close()

  console.log(`Base: ${host}`)
  console.log(`Usuario ${REVIEWER_EMAIL}: ${result.createdUser ? "creado" : "actualizado"} (${result.userId})`)
  console.log(`Negocio Peluquería Demo: ${result.createdBusiness ? "creado" : "actualizado"} (${result.businessId})`)
  console.log(`Turnos de ejemplo nuevos: ${result.bookingsCreated}; conversaciones nuevas: ${result.conversationsCreated}`)
  console.log("Listo. Entrá en /login → \"Entrar con email y contraseña\".")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
