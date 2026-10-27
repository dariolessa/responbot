import { desc } from "drizzle-orm"
import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { requirePermission } from "@/lib/auth/tenant"
import * as schema from "@/lib/db/schema"
import { priceLabel } from "@/lib/listings/items"
import { centsToInput } from "@/lib/money"

import { CatalogManager } from "./catalog-manager"

export const metadata: Metadata = { title: "Catálogo" }
// Las importaciones corren después de responder (after) y pueden leer hasta 31 páginas.
export const maxDuration = 300

export default async function CatalogoPage() {
  const { db } = await requirePermission("manageCatalog")
  const [business, sources, items] = await Promise.all([
    db.business(),
    db.catalogSources.findMany({ orderBy: schema.catalogSources.createdAt }),
    db.catalogItems.findMany({
      orderBy: [desc(schema.catalogItems.available), desc(schema.catalogItems.createdAt)],
      limit: 500,
    }),
  ])

  return (
    <>
      <PageHeader
        title="Catálogo"
        description="Pegá la dirección de tu web y el bot aprende lo que publicás (propiedades, productos) para mandárselo a quien pregunte, con fotos."
      />
      <CatalogManager
        currency={business?.currency ?? "UYU"}
        timezone={business?.timezone ?? "America/Montevideo"}
        sources={sources.map((s) => ({
          id: s.id,
          url: s.url,
          kind: s.kind,
          status: s.status,
          lastError: s.lastError,
          itemCount: s.itemCount,
          lastImportedAt: s.lastImportedAt?.toISOString() ?? null,
        }))}
        items={items.map((i) => ({
          id: i.id,
          fromWeb: i.sourceId !== null,
          title: i.title,
          description: i.description ?? "",
          price: i.price === null ? "" : centsToInput(i.price),
          priceLabel: priceLabel(i),
          currency: i.currency ?? business?.currency ?? "UYU",
          operation: i.operation ?? "",
          location: i.location ?? "",
          attributes: i.attributes.map((a) => `${a.label}: ${a.value}`).join("\n"),
          imageUrls: i.imageUrls,
          url: i.url ?? "",
          available: i.available,
          editedManually: i.editedManually,
        }))}
      />
    </>
  )
}
