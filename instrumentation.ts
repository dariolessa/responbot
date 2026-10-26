/**
 * Se ejecuta una vez al arrancar el servidor: valida las variables de entorno
 * y corta el arranque con un mensaje claro si falta alguna (lib/env.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SKIP_ENV_VALIDATION !== "1") {
    const { parseEnv } = await import("./lib/env")
    parseEnv(process.env)
  }
}
