import { describe, expect, it } from "vitest"

import {
  computeAvailability,
  firstFreePerStart,
  type AvailabilityInput,
} from "@/lib/booking/availability"
import { toTimeString } from "@/lib/time"

const TZ = "America/Montevideo" // UTC−3, sin horario de verano
const at = (iso: string) => new Date(iso)

// Lunes 2 de noviembre de 2026.
const MONDAY = "2026-11-02"

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    timezone: TZ,
    from: MONDAY,
    to: MONDAY,
    now: at("2026-10-27T12:00:00Z"),
    durationMinutes: 30,
    resources: [
      { id: "ana", workingHours: [{ weekday: 1, startTime: "09:00", endTime: "11:00" }] },
    ],
    busy: [],
    rules: { slotStepMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60, maxDaysAhead: 60 },
    ...overrides,
  }
}

const times = (slots: { startsAt: Date }[]) => slots.map((s) => toTimeString(s.startsAt, TZ))

describe("computeAvailability", () => {
  it("genera inicios cada paso donde entra el servicio, en la zona del negocio", () => {
    const slots = computeAvailability(input())
    expect(times(slots)).toEqual(["09:00", "09:30", "10:00", "10:30"])
    // 09:00 en Montevideo son las 12:00 UTC.
    expect(slots[0]!.startsAt.toISOString()).toBe("2026-11-02T12:00:00.000Z")
    expect(slots[0]!.endsAt.toISOString()).toBe("2026-11-02T12:30:00.000Z")
  })

  it("respeta varios tramos en el día (por ejemplo, con almuerzo)", () => {
    const slots = computeAvailability(
      input({
        durationMinutes: 60,
        resources: [
          {
            id: "ana",
            workingHours: [
              { weekday: 1, startTime: "15:00", endTime: "17:00" },
              { weekday: 1, startTime: "09:00", endTime: "10:00" },
            ],
          },
        ],
      }),
    )
    expect(times(slots)).toEqual(["09:00", "15:00", "15:30", "16:00"])
  })

  it("no ofrece días sin horario", () => {
    expect(computeAvailability(input({ from: "2026-11-03", to: "2026-11-03" }))).toEqual([])
  })

  it("resta turnos existentes y suma el buffer después de cada turno", () => {
    const busy = [
      {
        resourceId: "ana",
        startsAt: at("2026-11-02T12:30:00Z"), // 09:30
        endsAt: at("2026-11-02T13:00:00Z"), // 10:00
        kind: "booking" as const,
      },
    ]
    expect(times(computeAvailability(input({ busy })))).toEqual(["09:00", "10:00", "10:30"])

    const withBuffer = computeAvailability(
      input({
        busy,
        rules: { slotStepMinutes: 15, bufferMinutes: 15, minNoticeMinutes: 0, maxDaysAhead: 60 },
      }),
    )
    // 09:00 + 30 + 15 de buffer pisa el turno de 09:30; después del turno hay 15 de buffer.
    expect(times(withBuffer)).toEqual(["10:15", "10:30"])
  })

  it("resta bloqueos del profesional y de todo el negocio", () => {
    const own = computeAvailability(
      input({
        busy: [
          {
            resourceId: "ana",
            startsAt: at("2026-11-02T12:00:00Z"),
            endsAt: at("2026-11-02T13:00:00Z"),
            kind: "time_off",
          },
        ],
      }),
    )
    expect(times(own)).toEqual(["10:00", "10:30"])

    const holiday = computeAvailability(
      input({
        busy: [
          {
            resourceId: null,
            startsAt: at("2026-11-02T03:00:00Z"),
            endsAt: at("2026-11-03T03:00:00Z"),
            kind: "time_off",
          },
        ],
      }),
    )
    expect(holiday).toEqual([])
  })

  it("ignora bloqueos de otro profesional", () => {
    const slots = computeAvailability(
      input({
        busy: [
          {
            resourceId: "beto",
            startsAt: at("2026-11-02T12:00:00Z"),
            endsAt: at("2026-11-02T14:00:00Z"),
            kind: "booking",
          },
        ],
      }),
    )
    expect(slots).toHaveLength(4)
  })

  it("aplica la anticipación mínima y los días máximos hacia adelante", () => {
    // Ahora: lunes 09:10 local. Con 60 minutos de anticipación, el primero es 10:30.
    const now = at("2026-11-02T12:10:00Z")
    expect(times(computeAvailability(input({ now })))).toEqual(["10:30"])

    const tooFar = computeAvailability(
      input({
        now: at("2026-10-01T12:00:00Z"),
        rules: { slotStepMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 0, maxDaysAhead: 7 },
      }),
    )
    expect(tooFar).toEqual([])
  })

  it("desde el panel ignora la ventana de reserva pero no ofrece horarios pasados", () => {
    const now = at("2026-11-02T12:10:00Z") // 09:10
    const slots = computeAvailability(input({ now, ignoreBookingWindow: true }))
    expect(times(slots)).toEqual(["09:30", "10:00", "10:30"])
  })

  it("usa la duración propia del profesional", () => {
    const slots = computeAvailability(
      input({
        resources: [
          {
            id: "ana",
            durationMinutes: 90,
            workingHours: [{ weekday: 1, startTime: "09:00", endTime: "11:00" }],
          },
        ],
      }),
    )
    expect(times(slots)).toEqual(["09:00", "09:30"])
    expect(slots[0]!.endsAt.toISOString()).toBe("2026-11-02T13:30:00.000Z")
  })

  it("respeta el cambio de horario de la zona (Madrid, último domingo de octubre)", () => {
    const slots = computeAvailability(
      input({
        timezone: "Europe/Madrid",
        from: "2026-10-23",
        to: "2026-10-30",
        now: at("2026-10-20T00:00:00Z"),
        resources: [
          { id: "ana", workingHours: [{ weekday: 5, startTime: "09:00", endTime: "09:30" }] },
        ],
      }),
    )
    // Viernes 23 (UTC+2) y viernes 30 (UTC+1): siempre 09:00 local.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-10-23T07:00:00.000Z",
      "2026-10-30T08:00:00.000Z",
    ])
  })
})

describe("firstFreePerStart", () => {
  it("deja un horario por inicio, con el profesional preferido", () => {
    const slots = computeAvailability(
      input({
        resources: [
          { id: "beto", workingHours: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }] },
          { id: "ana", workingHours: [{ weekday: 1, startTime: "09:30", endTime: "10:30" }] },
        ],
      }),
    )
    const merged = firstFreePerStart(slots, ["ana", "beto"])
    expect(merged.map((s) => [toTimeString(s.startsAt, TZ), s.resourceId])).toEqual([
      ["09:00", "beto"],
      ["09:30", "ana"],
      ["10:00", "ana"],
    ])
  })
})
