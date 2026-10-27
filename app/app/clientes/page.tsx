import { and, desc, ilike, or, sql } from "drizzle-orm"
import { Search, UsersRound } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { Input } from "@/components/ui/input"
import { can } from "@/lib/auth/roles"
import { getTenant } from "@/lib/auth/tenant"
import { agendaAccess, customersVisibleWhere } from "@/lib/booking/access"
import * as schema from "@/lib/db/schema"
import { formatPhone } from "@/lib/phone"
import { formatZoned } from "@/lib/time"

import { NewCustomerButton } from "./new-customer"

export const metadata: Metadata = { title: "Clientes" }

const PAGE_SIZE = 50

export default async function ClientesPage({ searchParams }: PageProps<"/app/clientes">) {
  const params = await searchParams
  const tenant = await getTenant()
  const access = await agendaAccess(tenant)
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 60) : ""
  const digits = q.replace(/\D/g, "").replace(/^0+/, "")
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`

  const customers = await tenant.db.customers.findMany({
    where: and(
      customersVisibleWhere(access),
      q
        ? or(
            ilike(schema.customers.name, like),
            digits.length >= 3 ? ilike(schema.customers.phoneE164, `%${digits}%`) : undefined,
          )
        : undefined,
    ),
    orderBy: [sql`${schema.customers.lastVisitAt} desc nulls last`, desc(schema.customers.createdAt)],
    limit: PAGE_SIZE,
  })
  const canCreate = can(tenant.role, "viewAllAgenda")
  const timezone = tenant.business.timezone

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Visitas, gasto, inasistencias y notas de cada cliente."
        actions={canCreate ? <NewCustomerButton /> : undefined}
      />

      <form className="relative mb-4 max-w-md" role="search">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por nombre o teléfono"
          aria-label="Buscar clientes"
          className="pl-9"
        />
      </form>

      {customers.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={q ? "No encontramos clientes con eso" : "Todavía no tenés clientes"}
          description={
            q ? "Probá con otra parte del nombre o del teléfono." : "Se agregan solos cuando les das un turno."
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/clientes/${c.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name ?? "Sin nombre"}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{formatPhone(c.phoneE164)}</span>
                </span>
                <span className="hidden text-right text-xs text-muted-foreground sm:block">
                  {c.lastVisitAt
                    ? `Última visita: ${formatZoned(c.lastVisitAt, timezone, "d MMM yyyy")}`
                    : "Sin visitas todavía"}
                  {c.noShowCount > 0 ? (
                    <span className="block text-red-600 dark:text-red-400">
                      {c.noShowCount === 1 ? "1 inasistencia" : `${c.noShowCount} inasistencias`}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {customers.length === PAGE_SIZE ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Mostramos los primeros {PAGE_SIZE}. Buscá por nombre o teléfono para encontrar a alguien en particular.
        </p>
      ) : null}
    </>
  )
}
