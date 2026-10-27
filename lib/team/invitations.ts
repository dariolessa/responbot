import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { headers } from "next/headers"

import { invitationEmail } from "@/emails/invitation"
import { roleLabels } from "@/lib/auth/roles"
import type { Tenant } from "@/lib/auth/tenant"
import { audit } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/integrations/resend/client"

/** Las invitaciones vencen a los 7 días (docs/SPEC.md). */
export const INVITATION_DAYS = 7

/** URL pública de la app, para los enlaces de los correos. */
export async function appUrl(): Promise<string> {
  if (env.AUTH_URL) return new URL(env.AUTH_URL).origin
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

export type InviteResult = { sent: boolean }

/**
 * Invita a alguien al negocio por email. Al entrar con ese email se une con el
 * rol indicado (lib/db/scoped.ts, acceptPendingInvitations) y, si se pasó un
 * profesional, esa columna de la agenda pasa a ser suya.
 */
export async function inviteMember(
  tenant: Tenant,
  input: { email: string; role: schema.Role; resourceId?: string | null },
): Promise<InviteResult> {
  const { db: scoped, user } = tenant
  const email = input.email.trim().toLowerCase()

  // Una invitación vigente por email: se reemplaza por la nueva.
  await scoped.invitations.delete(
    and(
      sql`lower(${schema.invitations.email}) = ${email}`,
      isNull(schema.invitations.acceptedAt),
      gt(schema.invitations.expiresAt, new Date()),
    ),
  )

  const token = randomBytes(32).toString("base64url")
  const [invitation] = await scoped.invitations.insert({
    email,
    role: input.role,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    invitedBy: user.id,
    resourceId: input.resourceId ?? null,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
  })
  await audit(scoped, {
    actorId: user.id,
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitation!.id,
    metadata: { email, role: input.role },
  })

  // El enlace lleva a /login; la invitación se acepta por el email de la cuenta.
  const url = `${await appUrl()}/login?callbackUrl=${encodeURIComponent("/app/agenda")}`
  try {
    await sendEmail({
      to: email,
      ...invitationEmail({
        url,
        inviterName: user.name ?? user.email,
        businessName: tenant.business.businessName,
        roleLabel: roleLabels[input.role],
        days: INVITATION_DAYS,
      }),
    })
    return { sent: true }
  } catch (error) {
    // La invitación queda creada aunque el correo falle: alcanza con que entre con ese email.
    console.error("No se pudo enviar la invitación", error)
    return { sent: false }
  }
}

export async function revokeInvitation(tenant: Tenant, invitationId: string) {
  const [removed] = await tenant.db.invitations.delete(
    and(eq(schema.invitations.id, invitationId), isNull(schema.invitations.acceptedAt)),
  )
  if (removed) {
    await audit(tenant.db, {
      actorId: tenant.user.id,
      action: "invitation.revoked",
      targetType: "invitation",
      targetId: removed.id,
      metadata: { email: removed.email },
    })
  }
}
