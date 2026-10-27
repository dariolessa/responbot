"use client"

import { useRef, useState } from "react"

import { isOpen } from "@/lib/booking/policies"
import { minutesToTime, weekdayOf } from "@/lib/time"
import { cn } from "@/lib/utils"

import { BookingBlock } from "./booking-block"
import { PX_PER_MIN } from "./layout"
import type { AgendaBooking, AgendaResource, AgendaTimeOff } from "./types"

/*
 * Vista día: una columna por profesional (un profesional ve solo la suya).
 * Clic en un hueco para crear un turno; arrastrar un turno (con mouse) para
 * moverlo de hora o de profesional. En pantallas táctiles se mueve desde el
 * detalle del turno, para no pelear con el scroll.
 */

type Drag = {
  id: string
  pointerId: number
  startX: number
  startY: number
  /** Minutos entre el inicio del turno y donde se agarró. */
  grabOffset: number
  duration: number
  moved: boolean
}

export type GhostPosition = { id: string; resourceId: string; startMin: number }

export function TimeAxis({ start, end }: { start: number; end: number }) {
  const hours: number[] = []
  for (let m = start; m < end; m += 60) hours.push(m)
  return (
    <div className="relative w-12 shrink-0" style={{ height: (end - start) * PX_PER_MIN }}>
      {hours.map((m) => (
        <span
          key={m}
          className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground first:translate-y-0"
          style={{ top: (m - start) * PX_PER_MIN }}
        >
          {minutesToTime(m)}
        </span>
      ))}
    </div>
  )
}

/** Líneas de cada hora y media hora. */
export function GridLines({ start, end }: { start: number; end: number }) {
  const lines: number[] = []
  for (let m = start + 30; m < end; m += 30) lines.push(m)
  return (
    <>
      {lines.map((m) => (
        <div
          key={m}
          className={cn("pointer-events-none absolute inset-x-0 border-t", m % 60 === 0 ? "" : "border-dashed opacity-60")}
          style={{ top: (m - start) * PX_PER_MIN }}
        />
      ))}
    </>
  )
}

export function NowLine({ nowMin, start, end }: { nowMin: number; start: number; end: number }) {
  if (nowMin < start || nowMin > end) return null
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: (nowMin - start) * PX_PER_MIN }}
      aria-hidden
    >
      <span className="-ml-1 size-2 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  )
}

export function DayView({
  date,
  isToday,
  nowMin,
  range,
  slotStep,
  resources,
  bookings,
  timeOff,
  onSlotClick,
  onBookingClick,
  onMove,
}: {
  date: string
  isToday: boolean
  nowMin: number
  range: { start: number; end: number }
  slotStep: number
  resources: AgendaResource[]
  bookings: AgendaBooking[]
  timeOff: AgendaTimeOff[]
  onSlotClick: (resourceId: string, startMin: number) => void
  onBookingClick: (id: string) => void
  onMove: (id: string, resourceId: string, startMin: number) => void
}) {
  const weekday = weekdayOf(date)
  const height = (range.end - range.start) * PX_PER_MIN
  const columns = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const ghostRef = useRef<GhostPosition | null>(null)
  const [ghost, setGhostState] = useState<GhostPosition | null>(null)
  const setGhost = (value: GhostPosition | null) => {
    ghostRef.current = value
    setGhostState(value)
  }

  const snap = (min: number) => Math.round(min / slotStep) * slotStep

  function minuteAt(resourceId: string, clientY: number) {
    const el = columns.current.get(resourceId)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return range.start + (clientY - rect.top) / PX_PER_MIN
  }

  function columnAt(clientX: number) {
    for (const [id, el] of columns.current) {
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right) return id
    }
    return null
  }

  function startDrag(e: React.PointerEvent<HTMLButtonElement>, booking: AgendaBooking) {
    if (e.pointerType === "touch" || e.button !== 0 || !isOpen(booking.status)) return
    const grab = minuteAt(booking.resourceId, e.clientY)
    drag.current = {
      id: booking.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabOffset: grab === null ? 0 : grab - booking.startMin,
      duration: booking.endMin - booking.startMin,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return
    d.moved = true
    const resourceId = columnAt(e.clientX) ?? ghostRef.current?.resourceId
    if (!resourceId) return
    const minute = minuteAt(resourceId, e.clientY)
    if (minute === null) return
    const startMin = Math.min(
      Math.max(snap(minute - d.grabOffset), range.start),
      range.end - d.duration,
    )
    setGhost({ id: d.id, resourceId, startMin })
  }

  function endDrag(e: React.PointerEvent, booking: AgendaBooking) {
    const d = drag.current
    drag.current = null
    if (!d || e.pointerId !== d.pointerId) return
    const target = ghostRef.current
    suppressClick.current = d.moved
    if (d.moved && target && (target.resourceId !== booking.resourceId || target.startMin !== booking.startMin)) {
      onMove(booking.id, target.resourceId, target.startMin)
    }
    setGhost(null)
  }

  const ghostBooking = ghost ? bookings.find((b) => b.id === ghost.id) : undefined

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-fit">
        <div className="sticky left-0 z-20 w-12 shrink-0 border-r bg-background">
          <div className="h-11 border-b" />
          <div className="pt-0">
            <TimeAxis start={range.start} end={range.end} />
          </div>
        </div>
        {resources.map((resource) => {
          const working = resource.hours.filter((h) => h.weekday === weekday)
          const blocks = timeOff.filter((t) => t.resourceId === null || t.resourceId === resource.id)
          const own = bookings.filter((b) => b.resourceId === resource.id && b.date === date)
          return (
            <div key={resource.id} className="min-w-40 flex-1 border-r last:border-r-0">
              <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background px-3">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: resource.color }} />
                <span className="truncate text-sm font-medium">{resource.name}</span>
              </div>
              <div
                ref={(el) => {
                  if (el) columns.current.set(resource.id, el)
                  else columns.current.delete(resource.id)
                }}
                className="relative cursor-pointer bg-muted/50"
                style={{ height }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-booking]")) return
                  const minute = minuteAt(resource.id, e.clientY)
                  if (minute === null) return
                  onSlotClick(resource.id, Math.floor(minute / slotStep) * slotStep)
                }}
              >
                {working.map((h, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute inset-x-0 bg-background"
                    style={{
                      top: (Math.max(h.startMin, range.start) - range.start) * PX_PER_MIN,
                      height: (Math.min(h.endMin, range.end) - Math.max(h.startMin, range.start)) * PX_PER_MIN,
                    }}
                  />
                ))}
                <GridLines start={range.start} end={range.end} />
                {blocks.flatMap((t) =>
                  t.segments
                    .filter((s) => s.date === date)
                    .map((s, i) => (
                      <div
                        key={`${t.id}-${i}`}
                        title={t.reason ?? "Bloqueado"}
                        className="agenda-blocked pointer-events-none absolute inset-x-0 flex items-start justify-center overflow-hidden border-y border-muted-foreground/20 px-2 pt-1 text-[11px] text-muted-foreground"
                        style={{
                          top: (Math.max(s.startMin, range.start) - range.start) * PX_PER_MIN,
                          height: Math.max(
                            (Math.min(s.endMin, range.end) - Math.max(s.startMin, range.start)) * PX_PER_MIN,
                            0,
                          ),
                        }}
                      >
                        <span className="truncate rounded bg-background/80 px-1">{t.reason ?? "Bloqueado"}</span>
                      </div>
                    )),
                )}
                {own.map((b) => (
                  <BookingBlock
                    key={b.id}
                    booking={b}
                    rangeStart={range.start}
                    dragging={ghost?.id === b.id}
                    onPointerDown={(e) => startDrag(e, b)}
                    onPointerMove={moveDrag}
                    onPointerUp={(e) => endDrag(e, b)}
                    onClick={() => {
                      // Al soltar un arrastre el navegador también manda un clic: no abre el detalle.
                      if (suppressClick.current) {
                        suppressClick.current = false
                        return
                      }
                      onBookingClick(b.id)
                    }}
                  />
                ))}
                {ghost && ghostBooking && ghost.resourceId === resource.id ? (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed border-primary bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary"
                    style={{
                      top: (ghost.startMin - range.start) * PX_PER_MIN,
                      height: (ghostBooking.endMin - ghostBooking.startMin) * PX_PER_MIN,
                    }}
                  >
                    <span className="font-mono">{minutesToTime(ghost.startMin)}</span>
                  </div>
                ) : null}
                {isToday ? <NowLine nowMin={nowMin} start={range.start} end={range.end} /> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
