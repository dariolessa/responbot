import {
  datesBetween,
  minutesToTime,
  timeToMinutes,
  weekdayOf,
  zonedToUtc,
  type DateString,
} from "@/lib/time"

/*
 * Cálculo de horarios libres (docs/SPEC.md, "Reservas y disponibilidad").
 * Función pura: recibe todo lo que necesita y no toca la base. La usan el
 * panel (reserva manual) y, desde la Fase 2, el bot.
 *
 * 1. Para cada profesional que hace el servicio, su horario semanal del día
 *    (puede tener varios tramos).
 * 2. Se restan bloqueos (del profesional o de todo el negocio) y turnos
 *    existentes que ocupan lugar (el que llama ya filtró cancelados y vencidos).
 * 3. Inicios cada `slotStepMinutes` desde el comienzo de cada tramo, donde
 *    entren la duración del servicio más el buffer.
 * 4. Se descartan los que no cumplen la anticipación mínima o superan los días
 *    máximos hacia adelante.
 * 5. Todo en la zona del negocio; los resultados son instantes UTC.
 */

export type WeeklyRange = { weekday: number; startTime: string; endTime: string }

export type AvailabilityResource = {
  id: string
  workingHours: WeeklyRange[]
  /** Duración propia de este profesional para el servicio (resource_services.custom_duration). */
  durationMinutes?: number | null
}

export type BusyRange = {
  /** null = afecta a todo el negocio (feriado, cierre). */
  resourceId: string | null
  startsAt: Date
  endsAt: Date
  /** Los turnos suman el buffer al final; los bloqueos no. */
  kind: "booking" | "time_off"
}

export type AvailabilityRules = {
  slotStepMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
}

export type AvailabilityInput = {
  timezone: string
  /** Primer y último día a revisar, en la zona del negocio (ambos incluidos). */
  from: DateString
  to: DateString
  now: Date
  /** Duración del servicio por defecto. */
  durationMinutes: number
  resources: AvailabilityResource[]
  busy: BusyRange[]
  rules: AvailabilityRules
  /**
   * El panel puede dar turnos con menos anticipación o más lejos que lo que
   * se ofrece a los clientes; igual no ofrece horarios ya pasados.
   */
  ignoreBookingWindow?: boolean
}

export type Slot = { resourceId: string; startsAt: Date; endsAt: Date }

const MINUTE = 60_000

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd
}

export function computeAvailability(input: AvailabilityInput): Slot[] {
  const { timezone, rules, now } = input
  const step = Math.max(1, rules.slotStepMinutes)
  const buffer = Math.max(0, rules.bufferMinutes)

  const earliest = input.ignoreBookingWindow
    ? now.getTime()
    : now.getTime() + rules.minNoticeMinutes * MINUTE
  const latest = input.ignoreBookingWindow
    ? Number.POSITIVE_INFINITY
    : now.getTime() + rules.maxDaysAhead * 24 * 60 * MINUTE

  const busyFor = (resourceId: string) =>
    input.busy
      .filter((b) => b.resourceId === null || b.resourceId === resourceId)
      .map((b) => ({
        start: b.startsAt.getTime(),
        end: b.endsAt.getTime() + (b.kind === "booking" ? buffer * MINUTE : 0),
      }))

  const slots: Slot[] = []

  for (const resource of input.resources) {
    const duration = resource.durationMinutes ?? input.durationMinutes
    if (duration <= 0) continue
    const busy = busyFor(resource.id)

    for (const date of datesBetween(input.from, input.to)) {
      const weekday = weekdayOf(date)
      const ranges = resource.workingHours
        .filter((r) => r.weekday === weekday)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

      for (const range of ranges) {
        const rangeStart = timeToMinutes(range.startTime)
        const rangeEnd = timeToMinutes(range.endTime)

        for (let minute = rangeStart; minute + duration <= rangeEnd; minute += step) {
          // Cada inicio se convierte con la zona de ese día (cubre cambios de horario).
          const startsAt = zonedToUtc(date, minutesToTime(minute), timezone)
          const start = startsAt.getTime()
          const end = start + duration * MINUTE
          // El buffer tiene que entrar antes del próximo turno, pero no hace
          // falta que entre dentro del horario de trabajo.
          const endWithBuffer = end + buffer * MINUTE

          if (start < earliest || start > latest) continue
          if (busy.some((b) => overlaps(start, endWithBuffer, b.start, b.end))) continue

          slots.push({ resourceId: resource.id, startsAt, endsAt: new Date(end) })
        }
      }
    }
  }

  return slots.sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.resourceId.localeCompare(b.resourceId),
  )
}

/**
 * Para "cualquier profesional": un horario por inicio, eligiendo el primer
 * profesional libre (el orden de `resources` define la preferencia).
 */
export function firstFreePerStart(slots: Slot[], resourceOrder: string[]): Slot[] {
  const rank = new Map(resourceOrder.map((id, i) => [id, i]))
  const byStart = new Map<number, Slot>()
  for (const slot of slots) {
    const key = slot.startsAt.getTime()
    const current = byStart.get(key)
    if (!current || (rank.get(slot.resourceId) ?? 99) < (rank.get(current.resourceId) ?? 99)) {
      byStart.set(key, slot)
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}
