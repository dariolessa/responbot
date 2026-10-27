import { env } from "@/lib/env"

/**
 * URL pública de la app para enlaces que salen sin un pedido de por medio
 * (crons, push, correos de avisos): AUTH_URL o, en Vercel, el dominio de
 * producción del proyecto.
 */
export function publicAppUrl(): string {
  if (env.AUTH_URL) return new URL(env.AUTH_URL).origin
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`
  return "http://localhost:3000"
}
