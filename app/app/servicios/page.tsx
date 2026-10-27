import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"

import { ServicesManager } from "./services-manager"

export const metadata: Metadata = { title: "Servicios" }

export default async function ServiciosPage() {
  const { db } = await requirePermission("manageServices")
  const [business, services, resources, links] = await Promise.all([
    db.business(),
    db.services.findMany({ orderBy: [schema.services.sortOrder, schema.services.name] }),
    db.resources.findMany({ orderBy: [schema.resources.name] }),
    db.resourceServices.findMany(),
  ])

  return (
    <>
      <PageHeader title="Servicios" description="Precio, duración y seña de lo que ofrecés." />
      <ServicesManager
        currency={business?.currency ?? "UYU"}
        resources={resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          price: s.price,
          depositOverride: s.depositOverride,
          active: s.active,
          resourceIds: links.filter((l) => l.serviceId === s.id).map((l) => l.resourceId),
        }))}
      />
    </>
  )
}
