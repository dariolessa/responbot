import { BarChart3, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { UpgradeNotice } from "@/components/billing/upgrade-notice"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/auth/tenant"
import { billingState, hasFeature } from "@/lib/billing/state"
import { formatMoney } from "@/lib/money"
import { currentMonth, isMonthString, loadMonthStats, monthBounds, previousMonth } from "@/lib/stats"
import { formatDate } from "@/lib/time"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Estadísticas" }

const weekdayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
// La semana empieza el lunes.
const weekOrder = [1, 2, 3, 4, 5, 6, 0]

function nextMonth(month: string) {
  return monthBounds(month).next.slice(0, 7)
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
  return (
    <div className="rounded-[10px] border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-medium tracking-tight", tone === "danger" && "text-red-600 dark:text-red-400")}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Lista con barras horizontales: una fila por categoría, la barra relativa al máximo. */
function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section className="rounded-[10px] border p-4 sm:p-5">
      <h2 className="mb-4 text-sm font-medium">{title}</h2>
      <ul className="grid gap-2.5">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`

export default async function EstadisticasPage({ searchParams }: PageProps<"/app/estadisticas">) {
  const { mes } = await searchParams
  const { db, role } = await requirePermission("viewStats")
  const business = (await db.business())!
  const now = new Date()
  if (!hasFeature(billingState(business, now), "stats")) {
    return (
      <>
        <PageHeader title="Estadísticas" description="Turnos, ingresos e inasistencias del mes." />
        <UpgradeNotice feature="stats" isOwner={role === "owner"} />
      </>
    )
  }

  const thisMonth = currentMonth(now, business.timezone)
  const month = isMonthString(mes) && mes <= thisMonth ? mes : thisMonth
  const [stats, previous] = await Promise.all([
    loadMonthStats(db, month, business.timezone, business.currency),
    loadMonthStats(db, previousMonth(month), business.timezone, business.currency),
  ])
  const money = (cents: number) => formatMoney(cents, business.currency)
  const monthTitle = formatDate(monthBounds(month).first, "MMMM 'de' yyyy")
  const delta = (now: number, before: number) => {
    if (before === 0) return now > 0 ? "Primer mes con datos" : undefined
    const pct = Math.round(((now - before) / before) * 100)
    return `${pct >= 0 ? "+" : ""}${pct} % que el mes anterior`
  }

  const nav = (
    <div className="flex items-center gap-1">
      <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
        <Link href={`/app/estadisticas?mes=${previousMonth(month)}`}>
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-36 text-center text-sm font-medium first-letter:uppercase">{monthTitle}</span>
      {month < thisMonth ? (
        <Button asChild variant="outline" size="icon" aria-label="Mes siguiente">
          <Link href={`/app/estadisticas?mes=${nextMonth(month)}`}>
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" disabled aria-label="Mes siguiente">
          <ChevronRight />
        </Button>
      )}
    </div>
  )

  if (stats.bookings === 0 && stats.cancelled === 0) {
    return (
      <>
        <PageHeader title="Estadísticas" description="Turnos, ingresos e inasistencias del mes." actions={nav} />
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay turnos este mes"
          description="Con los primeros turnos vas a ver cómo viene el mes."
          action={
            <Button asChild>
              <Link href="/app/agenda">
                <CalendarDays />
                Ver la agenda
              </Link>
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Estadísticas" description="Turnos, ingresos e inasistencias del mes." actions={nav} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Turnos" value={String(stats.bookings)} hint={delta(stats.bookings, previous.bookings)} />
        <Stat
          label="Ingresos cobrados"
          value={money(stats.revenue)}
          hint={stats.pendingRevenue ? `${money(stats.pendingRevenue)} por cobrar` : delta(stats.revenue, previous.revenue)}
        />
        <Stat
          label="Inasistencias"
          value={String(stats.noShows)}
          hint={`${stats.noShowRate} % de los turnos que ya pasaron`}
          tone={stats.noShowRate >= 15 ? "danger" : undefined}
        />
        <Stat
          label="Tomados fuera de horario"
          value={String(stats.outsideHours)}
          hint={`El bot tomó ${stats.byBot} ${stats.byBot === 1 ? "reserva" : "reservas"} en total`}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {stats.completed} atendidos, {stats.open} por atender o sin marcar, {stats.cancelled} cancelados. Los ingresos
        salen del precio de cada turno.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Bars
          title="Horarios más pedidos"
          rows={stats.byHour.map((h) => ({ label: hourLabel(h.hour), count: h.count }))}
        />
        <div className="grid content-start gap-4">
          <Bars
            title="Días de la semana"
            rows={weekOrder.map((d) => ({
              label: weekdayNames[d]!,
              count: stats.byWeekday.find((w) => w.weekday === d)?.count ?? 0,
            }))}
          />
          {stats.topSlots.length ? (
            <section className="rounded-[10px] border p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-medium">Franjas con más demanda</h2>
              <ol className="grid gap-2 text-sm">
                {stats.topSlots.map((slot) => (
                  <li key={`${slot.weekday}-${slot.hour}`} className="flex justify-between gap-2">
                    <span>
                      {weekdayNames[slot.weekday]} a las {hourLabel(slot.hour)}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">{slot.count}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
