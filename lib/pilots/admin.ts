import "server-only"

import { notFound } from "next/navigation"
import { cache } from "react"

import { requireUser, type SessionUser } from "@/lib/auth/tenant"
import { db } from "@/lib/db"
import { env } from "@/lib/env"

import { isPlatformAdmin } from "./admins"
import { createDemoBusiness } from "./demo"
import { pilotOverview, setPilot } from "./overview"
import { reviewMarkdown } from "./review"

/*
 * Puerta de entrada del panel de la plataforma (/admin). Las pantallas y
 * acciones de /admin piden requirePlatformAdmin() y usan estas funciones; no
 * importan `db`. A quien no está en PLATFORM_ADMIN_EMAILS se le responde 404.
 */

export const requirePlatformAdmin = cache(async (): Promise<SessionUser> => {
  const user = await requireUser()
  if (!isPlatformAdmin(user.email, env.PLATFORM_ADMIN_EMAILS)) notFound()
  return user
})

export async function adminOverview(days: number, now: Date = new Date()) {
  await requirePlatformAdmin()
  return pilotOverview(db, now, days)
}

export async function adminSetPilot(businessId: string, endsAt: Date | null) {
  const user = await requirePlatformAdmin()
  return setPilot(db, { businessId, endsAt, actorId: user.id })
}

/** Crea la demo con el admin como dueño (o devuelve la que ya hay). */
export async function adminCreateDemo() {
  const user = await requirePlatformAdmin()
  return createDemoBusiness(db, user.id)
}

export async function adminReview(since: Date, now: Date = new Date()) {
  await requirePlatformAdmin()
  return reviewMarkdown(db, since, now)
}
