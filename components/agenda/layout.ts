import { weekdayOf } from "@/lib/time"

import type { AgendaBooking, AgendaResource } from "./types"

/** Alto de un minuto en la grilla (72 px por hora). */
export const PX_PER_MIN = 1.2

/** Rango de horas que muestra la grilla: el horario de trabajo y los turnos, en horas enteras. */
export function gridRange(
  resources: AgendaResource[],
  bookings: AgendaBooking[],
  dates: string[],
): { start: number; end: number } {
  const weekdays = new Set(dates.map(weekdayOf))
  const mins: number[] = []
  const maxs: number[] = []
  for (const r of resources) {
    for (const h of r.hours) {
      if (!weekdays.has(h.weekday)) continue
      mins.push(h.startMin)
      maxs.push(h.endMin)
    }
  }
  for (const b of bookings) {
    mins.push(b.startMin)
    maxs.push(b.endMin)
  }
  if (mins.length === 0) return { start: 8 * 60, end: 20 * 60 }
  const start = Math.max(0, Math.floor(Math.min(...mins) / 60) * 60)
  const end = Math.min(24 * 60, Math.ceil(Math.max(...maxs) / 60) * 60)
  return { start, end: Math.max(end, start + 60) }
}

/**
 * Carriles para turnos que se pisan en una misma columna (la vista semana
 * junta a todo el equipo): cada grupo de turnos superpuestos se reparte el ancho.
 */
export function assignLanes<T extends { id: string; startMin: number; endMin: number }>(
  items: T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const result = new Map<string, { lane: number; lanes: number }>()
  let cluster: { id: string; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    const lanes = laneEnds.length
    for (const item of cluster) result.set(item.id, { lane: item.lane, lanes })
    cluster = []
    laneEnds = []
  }

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= item.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.endMin)
    } else {
      laneEnds[lane] = item.endMin
    }
    cluster.push({ id: item.id, lane })
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  flush()
  return result
}

/** Turnos del día con los movimientos optimistas aplicados. */
export function withOverrides(
  bookings: AgendaBooking[],
  overrides: Record<string, Pick<AgendaBooking, "resourceId" | "date" | "startMin" | "endMin">>,
): AgendaBooking[] {
  return bookings.map((b) => (overrides[b.id] ? { ...b, ...overrides[b.id] } : b))
}
