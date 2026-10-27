"use client"

import { CheckCheck, CircleDollarSign } from "lucide-react"

import { minutesToTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { PX_PER_MIN } from "./layout"
import { statusBlockClass } from "./status"
import type { AgendaBooking } from "./types"

/** Bloque de un turno en la grilla, coloreado por estado. */
export function BookingBlock({
  booking,
  rangeStart,
  lane = 0,
  lanes = 1,
  resourceColor,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onClick,
}: {
  booking: AgendaBooking
  rangeStart: number
  lane?: number
  lanes?: number
  /** En la vista semana, un punto con el color del profesional. */
  resourceColor?: string
  dragging?: boolean
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void
  onClick?: () => void
}) {
  const top = (booking.startMin - rangeStart) * PX_PER_MIN
  const height = Math.max((booking.endMin - booking.startMin) * PX_PER_MIN, 20)
  const compact = height < 40
  const width = 100 / lanes

  return (
    <button
      type="button"
      data-booking
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      aria-label={`${minutesToTime(booking.startMin)}, ${booking.customerName}, ${booking.serviceName}`}
      className={cn(
        "absolute overflow-hidden rounded-md border px-1.5 text-left text-xs leading-tight transition-[opacity,box-shadow] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        compact ? "flex items-center gap-1 py-0" : "py-1",
        statusBlockClass[booking.status],
        dragging && "opacity-40",
      )}
      style={{
        top,
        height,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
    >
      <span className={cn("flex items-center gap-1", compact && "shrink-0")}>
        {resourceColor ? (
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: resourceColor }} />
        ) : null}
        <span className="font-mono">{minutesToTime(booking.startMin)}</span>
        {booking.status === "client_confirmed" ? <CheckCheck className="size-3" /> : null}
        {booking.depositStatus === "pending" || booking.depositStatus === "paid" ? (
          <CircleDollarSign className="size-3" aria-label="Con seña" />
        ) : null}
      </span>
      <span className={cn("block truncate font-medium", compact && "inline")}>{booking.customerName}</span>
      {compact ? null : <span className="block truncate opacity-80">{booking.serviceName}</span>}
    </button>
  )
}
