import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// En local las variables viven en .env.local (como en Next.js).
config({ path: ".env.local" })

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
})
