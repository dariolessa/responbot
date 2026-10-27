import "server-only"

import { timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env"

/**
 * Las rutas de cron exigen `Authorization: Bearer ${CRON_SECRET}`
 * (Vercel Cron lo manda solo cuando CRON_SECRET está definida).
 */
export function isAuthorizedCron(request: Request): boolean {
  const header = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${env.CRON_SECRET}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Respuesta común de los crons que todavía no hacen nada (Fase 0). */
export function cronHandler(name: string) {
  return async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 })
    }
    return Response.json({ ok: true, cron: name, ranAt: new Date().toISOString() })
  }
}
