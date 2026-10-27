import { and, gt, isNull } from "drizzle-orm"
import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"

import { TeamManager } from "./team-manager"

export const metadata: Metadata = { title: "Equipo" }

export default async function EquipoPage() {
  const { db, user } = await requirePermission("manageTeam")
  const [resources, services, links, hours, members, invitations] = await Promise.all([
    db.resources.findMany({ orderBy: [schema.resources.name] }),
    db.services.findMany({ orderBy: [schema.services.sortOrder, schema.services.name] }),
    db.resourceServices.findMany(),
    db.workingHours.findMany(),
    db.members(),
    db.invitations.findMany({
      where: and(isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())),
      orderBy: [schema.invitations.createdAt],
    }),
  ])

  return (
    <>
      <PageHeader title="Equipo" description="Profesionales, horarios, invitaciones y roles." />
      <TeamManager
        currentUserId={user.id}
        services={services.map((s) => ({ id: s.id, name: s.name }))}
        staff={resources.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          active: r.active,
          userId: r.userId,
          serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
          hours: hours
            .filter((h) => h.resourceId === r.id)
            .map((h) => ({
              weekday: h.weekday,
              startTime: h.startTime.slice(0, 5),
              endTime: h.endTime.slice(0, 5),
            })),
        }))}
        members={members}
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          resourceId: i.resourceId,
          expiresAt: i.expiresAt.toISOString(),
        }))}
      />
    </>
  )
}
