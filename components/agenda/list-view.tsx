"use client"

import { CalendarDays, CheckCheck, CircleDollarSign } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { statusLabels } from "@/lib/booking/policies"
import { formatDate, minutesToTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { statusDotClass } from "./status"
import type { AgendaBooking, AgendaResource } from "./types"

/** Vista lista: los turnos de los próximos días, agrupados por día. */
export function ListView({
  dates,
  today,
  bookings,
  resources,
  onBookingClick,
  onCreate,
}: {
  dates: string[]
  today: string
  bookings: AgendaBooking[]
  resources: AgendaResource[]
  onBookingClick: (id: string) => void
  onCreate: () => void
}) {
  const nameOf = new Map(resources.map((r) => [r.id, r.name]))
  const days = dates
    .map((date) => ({ date, items: bookings.filter((b) => b.date === date) }))
    .filter((d) => d.items.length > 0)

  if (days.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No hay turnos en estos días"
        action={
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:h-9"
          >
            Crear turno
          </button>
        }
      />
    )
  }

  return (
    <div className="grid gap-6">
      {days.map(({ date, items }) => (
        <section key={date}>
          <h2 className="mb-2 text-sm font-medium first-letter:uppercase">
            {date === today ? "Hoy, " : ""}
            {formatDate(date)}
          </h2>
          <ul className="divide-y rounded-lg border">
            {items.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onBookingClick(b.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-accent/50"
                >
                  <span className="w-24 shrink-0 font-mono text-sm">
                    {minutesToTime(b.startMin)}
                    <span className="text-muted-foreground">–{minutesToTime(b.endMin)}</span>
                  </span>
                  <span className={cn("min-w-0 flex-1", b.status === "cancelled" && "line-through opacity-60")}>
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {b.customerName}
                      {b.status === "client_confirmed" ? <CheckCheck className="size-3.5 text-primary" /> : null}
                      {b.depositStatus === "pending" || b.depositStatus === "paid" ? (
                        <CircleDollarSign className="size-3.5 text-muted-foreground" aria-label="Con seña" />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {b.serviceName}
                      {resources.length > 1 ? ` · ${nameOf.get(b.resourceId) ?? ""}` : ""}
                    </span>
                  </span>
                  <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    <span className={cn("size-2 rounded-full", statusDotClass[b.status])} />
                    {statusLabels[b.status]}
                  </span>
                  <span className="hidden w-20 text-right font-mono text-sm sm:block">{b.price}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
