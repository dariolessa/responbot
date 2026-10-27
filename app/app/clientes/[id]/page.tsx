import { and, desc, eq, inArray } from "drizzle-orm"
import { ArrowLeft, MessageCircle, MessagesSquare, Phone } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { statusDotClass } from "@/components/agenda/status"
import { UpgradeNotice } from "@/components/billing/upgrade-notice"
import { Button } from "@/components/ui/button"
import { getTenant } from "@/lib/auth/tenant"
import { billingState, hasFeature } from "@/lib/billing/state"
import { agendaAccess, bookingsVisibleWhere, canSeeCustomer } from "@/lib/booking/access"
import { statusLabels } from "@/lib/booking/policies"
import * as schema from "@/lib/db/schema"
import { formatMoney } from "@/lib/money"
import { formatPhone } from "@/lib/phone"
import { formatZoned } from "@/lib/time"
import { cn } from "@/lib/utils"

import { EditCustomer } from "./edit-customer"

export const metadata: Metadata = { title: "Cliente" }

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-medium", tone === "danger" && "text-red-600 dark:text-red-400")}>
        {value}
      </p>
    </div>
  )
}

/** Ficha del cliente (docs/SPEC.md: visitas, gasto total, inasistencias, notas, conversación). */
export default async function ClientePage({ params }: PageProps<"/app/clientes/[id]">) {
  const { id } = await params
  const tenant = await getTenant()
  const access = await agendaAccess(tenant)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await canSeeCustomer(tenant.db, access, id))) notFound()

  const customer = (await tenant.db.customers.findById(id))!
  const business = (await tenant.db.business())!
  const timezone = business.timezone

  // La ficha completa viene con el plan Pro o superior.
  if (!hasFeature(billingState(business, new Date()), "customerProfiles")) {
    return (
      <>
        <Link
          href="/app/clientes"
          className="mb-4 inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:h-auto"
        >
          <ArrowLeft className="size-4" />
          Clientes
        </Link>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{customer.name ?? "Cliente sin nombre"}</h1>
        <p className="mb-8 font-mono text-sm text-muted-foreground">{formatPhone(customer.phoneE164)}</p>
        <UpgradeNotice feature="customerProfiles" isOwner={tenant.role === "owner"} />
      </>
    )
  }

  const bookings = await tenant.db.bookings.findMany({
    where: and(eq(schema.bookings.customerId, id), bookingsVisibleWhere(access)),
    orderBy: [desc(schema.bookings.startsAt)],
    limit: 200,
  })
  const serviceIds = [...new Set(bookings.map((b) => b.serviceId))]
  const resourceIds = [...new Set(bookings.map((b) => b.resourceId))]
  const [services, resources] = await Promise.all([
    serviceIds.length ? tenant.db.services.findMany({ where: inArray(schema.services.id, serviceIds) }) : [],
    resourceIds.length ? tenant.db.resources.findMany({ where: inArray(schema.resources.id, resourceIds) }) : [],
  ])

  const now = new Date()
  const completed = bookings.filter((b) => b.status === "completed")
  const spentByCurrency = new Map<string, number>()
  for (const b of completed) spentByCurrency.set(b.currency, (spentByCurrency.get(b.currency) ?? 0) + b.price)
  const spent =
    spentByCurrency.size === 0
      ? formatMoney(0, business.currency)
      : [...spentByCurrency].map(([currency, cents]) => formatMoney(cents, currency)).join(" + ")
  const upcoming = bookings
    .filter((b) => b.startsAt >= now && ["pending_payment", "confirmed", "client_confirmed"].includes(b.status))
    .reverse()
  const past = bookings.filter((b) => !upcoming.includes(b))
  const digits = customer.phoneE164.replace(/\D/g, "")

  const row = (b: (typeof bookings)[number]) => (
    <li key={b.id} className="flex items-center gap-3 px-4 py-3">
      <span className={cn("size-2 shrink-0 rounded-full", statusDotClass[b.status])} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", b.status === "cancelled" && "line-through opacity-60")}>
          {services.find((s) => s.id === b.serviceId)?.name ?? "Servicio"}
          <span className="text-muted-foreground"> · {resources.find((r) => r.id === b.resourceId)?.name}</span>
        </span>
        <span className="block text-xs text-muted-foreground first-letter:uppercase">
          {formatZoned(b.startsAt, timezone, "EEEE d MMM yyyy, HH:mm")} · {statusLabels[b.status]}
        </span>
      </span>
      <span className="font-mono text-sm">{formatMoney(b.price, b.currency)}</span>
    </li>
  )

  return (
    <>
      <Link
        href="/app/clientes"
        className="mb-4 inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:h-auto"
      >
        <ArrowLeft className="size-4" />
        Clientes
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name ?? "Sin nombre"}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{formatPhone(customer.phoneE164)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`tel:+${digits}`}>
              <Phone />
              Llamar
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
              <MessageCircle />
              WhatsApp
            </a>
          </Button>
          <EditCustomer
            id={customer.id}
            initial={{
              name: customer.name ?? "",
              phone: formatPhone(customer.phoneE164),
              notes: customer.notes ?? "",
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visitas" value={String(completed.length)} />
        <Stat label="Gasto total" value={spent} />
        <Stat
          label="Inasistencias"
          value={String(customer.noShowCount)}
          tone={customer.noShowCount > 0 ? "danger" : undefined}
        />
        <Stat
          label="Última visita"
          value={customer.lastVisitAt ? formatZoned(customer.lastVisitAt, timezone, "d MMM yyyy") : "—"}
        />
      </div>
      {customer.avgIntervalDays ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Viene cada {customer.avgIntervalDays} {customer.avgIntervalDays === 1 ? "día" : "días"} en promedio.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium">Notas</h2>
        {customer.notes ? (
          <p className="rounded-lg border p-4 text-sm whitespace-pre-wrap">{customer.notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin notas. Usá “Editar” para agregar preferencias o datos útiles.</p>
        )}
      </section>

      {upcoming.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium">Próximos turnos</h2>
          <ul className="divide-y rounded-lg border">{upcoming.map(row)}</ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium">Historial</h2>
        {past.length > 0 ? (
          <ul className="divide-y rounded-lg border">{past.map(row)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no tiene turnos pasados.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium">Conversación</h2>
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <MessagesSquare className="size-5 shrink-0" />
          Cuando conectes WhatsApp vas a ver acá la conversación con este cliente.
        </div>
      </section>
    </>
  )
}
