"use client"

import Link from "next/link"

import { formatDate, weekdayOf } from "@/lib/time"
import { cn } from "@/lib/utils"

import { BookingBlock } from "./booking-block"
import { GridLines, NowLine, TimeAxis } from "./day-view"
import { PX_PER_MIN, assignLanes } from "./layout"
import type { AgendaBooking, AgendaResource, AgendaTimeOff } from "./types"

/*
 * Vista semana: una columna por día con los turnos de todo el equipo visible
 * (o del profesional filtrado). Clic en el día abre la vista día.
 */
export function WeekView({
  dates,
  today,
  nowMin,
  range,
  slotStep,
  resources,
  bookings,
  timeOff,
  dayHref,
  onSlotClick,
  onBookingClick,
}: {
  dates: string[]
  today: string
  nowMin: number
  range: { start: number; end: number }
  slotStep: number
  resources: AgendaResource[]
  bookings: AgendaBooking[]
  timeOff: AgendaTimeOff[]
  dayHref: (date: string) => string
  onSlotClick: (date: string, startMin: number) => void
  onBookingClick: (id: string) => void
}) {
  const height = (range.end - range.start) * PX_PER_MIN
  const colorOf = new Map(resources.map((r) => [r.id, r.color]))
  const resourceIds = new Set(resources.map((r) => r.id))
  // Un bloqueo se marca en la semana solo si es de todo el negocio o afecta a todos los visibles.
  const blocksFor = (date: string) =>
    timeOff
      .filter((t) => t.resourceId === null || (resources.length === 1 && resourceIds.has(t.resourceId)))
      .flatMap((t) => t.segments.filter((s) => s.date === date).map((s) => ({ ...s, id: t.id, reason: t.reason })))

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-[52rem]">
        <div className="sticky left-0 z-20 w-12 shrink-0 border-r bg-background">
          <div className="h-14 border-b" />
          <TimeAxis start={range.start} end={range.end} />
        </div>
        {dates.map((date) => {
          const weekday = weekdayOf(date)
          const dayBookings = bookings.filter((b) => b.date === date)
          const lanes = assignLanes(dayBookings)
          const anyWorking = resources.some((r) => r.hours.some((h) => h.weekday === weekday))
          const isToday = date === today
          return (
            <div key={date} className="min-w-0 flex-1 border-r last:border-r-0">
              <Link
                href={dayHref(date)}
                className="sticky top-0 z-10 flex h-14 flex-col items-center justify-center border-b bg-background text-sm transition-colors duration-150 hover:bg-accent"
              >
                <span className="text-xs text-muted-foreground capitalize">{formatDate(date, "EEE")}</span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full font-mono font-medium",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {formatDate(date, "d")}
                </span>
              </Link>
              <div
                className={cn("relative cursor-pointer", anyWorking ? "bg-background" : "bg-muted/50")}
                style={{ height }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-booking]")) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const minute = range.start + (e.clientY - rect.top) / PX_PER_MIN
                  onSlotClick(date, Math.floor(minute / slotStep) * slotStep)
                }}
              >
                <GridLines start={range.start} end={range.end} />
                {blocksFor(date).map((s, i) => (
                  <div
                    key={`${s.id}-${i}`}
                    title={s.reason ?? "Bloqueado"}
                    className="agenda-blocked pointer-events-none absolute inset-x-0"
                    style={{
                      top: (Math.max(s.startMin, range.start) - range.start) * PX_PER_MIN,
                      height: Math.max(
                        (Math.min(s.endMin, range.end) - Math.max(s.startMin, range.start)) * PX_PER_MIN,
                        0,
                      ),
                    }}
                  />
                ))}
                {dayBookings.map((b) => {
                  const lane = lanes.get(b.id)
                  return (
                    <BookingBlock
                      key={b.id}
                      booking={b}
                      rangeStart={range.start}
                      lane={lane?.lane}
                      lanes={lane?.lanes}
                      resourceColor={resources.length > 1 ? colorOf.get(b.resourceId) : undefined}
                      onClick={() => onBookingClick(b.id)}
                    />
                  )
                })}
                {isToday ? <NowLine nowMin={nowMin} start={range.start} end={range.end} /> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
