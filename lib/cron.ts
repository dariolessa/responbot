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

/** Ruta de cron: valida el secreto, corre el trabajo y responde qué hizo. */
export function cronHandler(name: string, work?: () => Promise<unknown>) {
  return async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 })
    }
    const result = work ? await work() : undefined
    return Response.json({ ok: true, cron: name, result, ranAt: new Date().toISOString() })
  }
}
