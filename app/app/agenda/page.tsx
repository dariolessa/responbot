import { and, gt, inArray, isNull, lt, notInArray, or } from "drizzle-orm"
import type { Metadata } from "next"

import { AgendaView } from "@/components/agenda/agenda-view"
import type { AgendaData, AgendaView as View } from "@/components/agenda/types"
import { PendingStepsCard } from "@/components/onboarding/pending-steps"
import { getTenant } from "@/lib/auth/tenant"
import { agendaAccess, bookingsVisibleWhere } from "@/lib/booking/access"
import { resourceColor } from "@/lib/colors"
import * as schema from "@/lib/db/schema"
import { formatMoney } from "@/lib/money"
import { formatPhone } from "@/lib/phone"
import {
  addDaysToDate,
  dayRange,
  datesBetween,
  formatZoned,
  isDateString,
  minutesOfDay,
  startOfWeekDate,
  timeToMinutes,
  toDateString,
} from "@/lib/time"

export const metadata: Metadata = { title: "Agenda" }

const views: View[] = ["dia", "semana", "lista"]
const LIST_DAYS = 14

export default async function AgendaPage({ searchParams }: PageProps<"/app/agenda">) {
  const params = await searchParams
  const tenant = await getTenant()
  const { db } = tenant
  const access = await agendaAccess(tenant)

  const business = (await db.business())!
  const timezone = business.timezone
  const now = new Date()
  const today = toDateString(now, timezone)

  const view = views.includes(params.vista as View) ? (params.vista as View) : "dia"
  const date = typeof params.fecha === "string" && isDateString(params.fecha) ? params.fecha : today
  const from = view === "semana" ? startOfWeekDate(date) : date
  const to = view === "semana" ? addDaysToDate(from, 6) : view === "lista" ? addDaysToDate(from, LIST_DAYS - 1) : date
  const dates = datesBetween(from, to)
  const rangeStart = dayRange(from, timezone).start
  const rangeEnd = dayRange(to, timezone).end

  const [allResources, rules, services, links, hours] = await Promise.all([
    db.resources.findMany({ orderBy: [schema.resources.createdAt] }),
    db.bookingRules.findFirst(),
    db.services.findMany({ orderBy: [schema.services.sortOrder, schema.services.name] }),
    db.resourceServices.findMany(),
    db.workingHours.findMany(),
  ])
  const colorIndex = new Map(allResources.map((r, i) => [r.id, i]))
  const visibleResources = allResources.filter(
    (r) => r.active && (access.all || access.resourceIds.includes(r.id)),
  )
  const visibleIds = visibleResources.map((r) => r.id)

  const resourceFilter =
    typeof params.profesional === "string" && visibleIds.includes(params.profesional)
      ? params.profesional
      : null

  const visibleBlocks = visibleIds.length
    ? or(isNull(schema.timeOff.resourceId), inArray(schema.timeOff.resourceId, visibleIds))
    : isNull(schema.timeOff.resourceId)

  const [bookings, blocks, upcoming] = await Promise.all([
    visibleIds.length
      ? db.bookings.findMany({
          where: and(
            lt(schema.bookings.startsAt, rangeEnd),
            gt(schema.bookings.endsAt, rangeStart),
            bookingsVisibleWhere(access),
            inArray(schema.bookings.resourceId, visibleIds),
            // Los cancelados solo se ven en la lista; los vencidos, en ningún lado.
            view === "lista"
              ? notInArray(schema.bookings.status, ["expired"])
              : notInArray(schema.bookings.status, ["expired", "cancelled"]),
          ),
          orderBy: [schema.bookings.startsAt],
        })
      : Promise.resolve([]),
    db.timeOff.findMany({
      where: and(lt(schema.timeOff.startsAt, rangeEnd), gt(schema.timeOff.endsAt, rangeStart), visibleBlocks),
    }),
    db.timeOff.findMany({
      where: and(gt(schema.timeOff.endsAt, now), visibleBlocks),
      orderBy: [schema.timeOff.startsAt],
      limit: 50,
    }),
  ])

  const blockLabel = (t: { startsAt: Date; endsAt: Date }) =>
    `${formatZoned(t.startsAt, timezone, "EEE d MMM HH:mm")} – ${formatZoned(t.endsAt, timezone, "EEE d MMM HH:mm")}`

  const customerIds = [...new Set(bookings.map((b) => b.customerId))]
  const customers = customerIds.length
    ? await db.customers.findMany({ where: inArray(schema.customers.id, customerIds) })
    : []

  /** Parte de un rango [inicio, fin) que cae en cada día visible, en minutos locales. */
  const segmentsOf = (startsAt: Date, endsAt: Date) =>
    dates.flatMap((d) => {
      const day = dayRange(d, timezone)
      if (endsAt <= day.start || startsAt >= day.end) return []
      const startMin = startsAt <= day.start ? 0 : minutesOfDay(startsAt, timezone)
      const endMin = endsAt >= day.end ? 24 * 60 : minutesOfDay(endsAt, timezone)
      return [{ date: d, startMin, endMin }]
    })

  const data: AgendaData = {
    view,
    date,
    today,
    dates,
    nowMin: minutesOfDay(now, timezone),
    timezone,
    canManageAll: access.all,
    hasOwnColumn: access.all || access.resourceIds.length > 0,
    slotStep: rules?.slotStepMinutes ?? 15,
    resourceFilter,
    resources: visibleResources.map((r) => ({
      id: r.id,
      name: r.name,
      color: resourceColor(r.color, colorIndex.get(r.id) ?? 0),
      hours: hours
        .filter((h) => h.resourceId === r.id)
        .map((h) => ({
          weekday: h.weekday,
          startMin: timeToMinutes(h.startTime),
          endMin: timeToMinutes(h.endTime),
        })),
      serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
    })),
    bookings: bookings.map((b) => {
      const customer = customers.find((c) => c.id === b.customerId)
      const service = services.find((s) => s.id === b.serviceId)
      const segment = segmentsOf(b.startsAt, b.endsAt)[0] ?? {
        date: toDateString(b.startsAt, timezone),
        startMin: minutesOfDay(b.startsAt, timezone),
        endMin: minutesOfDay(b.endsAt, timezone),
      }
      return {
        id: b.id,
        resourceId: b.resourceId,
        serviceId: b.serviceId,
        customerId: b.customerId,
        customerName: customer?.isTest
          ? `Cliente de prueba${customer.name ? ` (${customer.name})` : ""}`
          : (customer?.name ?? (customer ? formatPhone(customer.phoneE164) : "Cliente")),
        customerPhone: customer && !customer.isTest ? customer.phoneE164 : "",
        serviceName: service?.name ?? "Servicio",
        status: b.status,
        date: segment.date,
        startMin: segment.startMin,
        endMin: Math.max(segment.endMin, segment.startMin + 5),
        startsAt: b.startsAt.toISOString(),
        price: formatMoney(b.price, b.currency),
        depositStatus: b.depositStatus,
        source: b.source,
        cancelReason: b.cancelReason,
      }
    }),
    timeOff: blocks.map((t) => ({
      id: t.id,
      resourceId: t.resourceId,
      reason: t.reason,
      segments: segmentsOf(t.startsAt, t.endsAt),
      label: blockLabel(t),
    })),
    upcomingTimeOff: upcoming.map((t) => ({
      id: t.id,
      resourceId: t.resourceId,
      reason: t.reason,
      label: blockLabel(t),
    })),
    services: services
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: formatMoney(s.price, business.currency),
      })),
  }

  return (
    <>
      {access.all ? <PendingStepsCard completed={business.onboardingCompleted} /> : null}
      <AgendaView data={data} />
    </>
  )
}
