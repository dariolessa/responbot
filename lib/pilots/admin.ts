import "server-only"

import { notFound } from "next/navigation"
import { cache } from "react"

import { requireUser, type SessionUser } from "@/lib/auth/tenant"
import { db } from "@/lib/db"
import { forBusiness } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { businessDetail, conversationThread, extendTrial, recentConversations, recentProblems, searchBusinesses } from "@/lib/support/detail"
import { startSupport } from "@/lib/support/mode"

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

// ---------------------------------------------------------------------------
// Soporte (/admin/soporte): buscar negocios, ficha, problemas y conversaciones.
// ---------------------------------------------------------------------------

export async function adminSearchBusinesses(term: string, now: Date = new Date()) {
  await requirePlatformAdmin()
  return searchBusinesses(db, term, now)
}

export async function adminBusinessDetail(businessId: string, now: Date = new Date()) {
  await requirePlatformAdmin()
  const detail = await businessDetail(db, businessId, now)
  if (!detail) return null
  const scoped = forBusiness(db, businessId)
  const [problems, conversations] = await Promise.all([recentProblems(scoped, now), recentConversations(scoped)])
  return { ...detail, problems, conversations }
}

export async function adminConversation(businessId: string, conversationId: string) {
  await requirePlatformAdmin()
  const scoped = forBusiness(db, businessId)
  const business = await scoped.business()
  if (!business) return null
  const thread = await conversationThread(scoped, conversationId)
  return thread ? { business, ...thread } : null
}

export async function adminExtendTrial(businessId: string, days: number) {
  const user = await requirePlatformAdmin()
  return extendTrial(db, { businessId, days, actorId: user.id, now: new Date() })
}

export async function adminStartSupport(businessId: string) {
  const user = await requirePlatformAdmin()
  return startSupport({ businessId, userId: user.id, email: user.email })
}
