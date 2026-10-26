import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` tira error fuera de React Server Components; en tests no aplica.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    env: { SKIP_ENV_VALIDATION: "1" },
    // PGlite levanta Postgres en WebAssembly: el primer arranque tarda unos segundos.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
