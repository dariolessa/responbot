import "server-only"

import { cookies } from "next/headers"
import { cache } from "react"

import { db } from "@/lib/db"
import { forBusiness } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { isPlatformAdmin } from "@/lib/pilots/admins"

/*
 * Modo soporte: alguien de PLATFORM_ADMIN_EMAILS entra al panel de un negocio
 * para ver lo mismo que ve su equipo y ayudarlo. No toma la cuenta de nadie:
 * sigue siendo él (lo que haga queda a su nombre) y entra con el rol Admin
 * del negocio, así que no ve Facturación ni puede transferir o borrar el
 * negocio. La cookie solo guarda qué negocio; en cada pedido se vuelve a
 * revisar que el usuario sea de la plataforma, así que copiarla no sirve de
 * nada. Entrar y salir queda en la auditoría del negocio, y el panel muestra
 * una franja fija mientras dura.
 */

export const SUPPORT_COOKIE = "rb_soporte"
/** Dos horas: después hay que volver a entrar desde /admin. */
export const SUPPORT_MAX_AGE = 2 * 60 * 60

/** Negocio en modo soporte del usuario, o null si no está en modo soporte (o no es de la plataforma). */
export async function supportBusinessId(email: string): Promise<string | null> {
  if (!isPlatformAdmin(email, env.PLATFORM_ADMIN_EMAILS)) return null
  const value = (await cookies()).get(SUPPORT_COOKIE)?.value
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

/** Negocio en modo soporte, solo si todavía existe (una cookie de un negocio borrado no cuenta). */
export const supportBusiness = cache(async (email: string) => {
  const businessId = await supportBusinessId(email)
  if (!businessId) return null
  return (await forBusiness(db, businessId).business()) ?? null
})

export async function startSupport(input: { businessId: string; userId: string; email: string }) {
  if (!isPlatformAdmin(input.email, env.PLATFORM_ADMIN_EMAILS)) return null
  const scoped = forBusiness(db, input.businessId)
  const business = await scoped.business()
  if (!business) return null
  await scoped.auditLogs.insert({
    actorId: input.userId,
    action: "platform.support_started",
    targetType: "business",
    targetId: business.id,
    metadata: { email: input.email },
  })
  ;(await cookies()).set(SUPPORT_COOKIE, business.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUPPORT_MAX_AGE,
  })
  return business
}

export async function endSupport(input: { userId: string; email: string }) {
  const store = await cookies()
  const businessId = await supportBusinessId(input.email)
  store.delete(SUPPORT_COOKIE)
  if (!businessId) return null
  const scoped = forBusiness(db, businessId)
  if (!(await scoped.business())) return null
  await scoped.auditLogs.insert({
    actorId: input.userId,
    action: "platform.support_ended",
    targetType: "business",
    targetId: businessId,
    metadata: { email: input.email },
  })
  return businessId
}
