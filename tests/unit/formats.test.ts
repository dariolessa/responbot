import { describe, expect, it } from "vitest"

import { weeklyHoursInput } from "@/lib/forms"
import { centsToInput, formatMoney, parseMoney } from "@/lib/money"
import { nextStepHref, pendingSteps, withCompleted } from "@/lib/onboarding/steps"
import { formatPhone, normalizePhone } from "@/lib/phone"
import { addDaysToDate, startOfWeekDate, weekdayOf } from "@/lib/time"

describe("montos", () => {
  it("entiende cómo se escriben los precios en Uruguay", () => {
    expect(parseMoney("1250")).toBe(125000)
    expect(parseMoney("1.250")).toBe(125000)
    expect(parseMoney("1250,50")).toBe(125050)
    expect(parseMoney("1.250,5")).toBe(125050)
    expect(parseMoney("$ 600")).toBe(60000)
    expect(parseMoney("12.5")).toBe(1250)
    expect(parseMoney("")).toBeNull()
    expect(parseMoney("abc")).toBeNull()
  })

  it("muestra centésimos solo si los hay", () => {
    expect(formatMoney(125000, "UYU")).toMatch(/1\.250$/)
    expect(formatMoney(125050, "UYU")).toMatch(/1\.250,50$/)
    expect(centsToInput(125050)).toBe("1250,50")
    expect(centsToInput(60000)).toBe("600")
  })
})

describe("teléfonos", () => {
  const tz = "America/Montevideo"

  it("completa el país del negocio", () => {
    expect(normalizePhone("099 123 456", tz)).toBe("+59899123456")
    expect(normalizePhone("99123456", tz)).toBe("+59899123456")
    expect(normalizePhone("59899123456", tz)).toBe("+59899123456")
    expect(normalizePhone("11 5555 4444", "America/Argentina/Buenos_Aires")).toBe("+541155554444")
  })

  it("respeta un número internacional", () => {
    expect(normalizePhone("+54 9 11 5555 4444", tz)).toBe("+5491155554444")
    expect(normalizePhone("0054 9 11 5555 4444", tz)).toBe("+5491155554444")
  })

  it("rechaza lo que no es un teléfono", () => {
    expect(normalizePhone("123", tz)).toBeNull()
    expect(normalizePhone("hola", tz)).toBeNull()
  })

  it("agrupa para leer", () => {
    expect(formatPhone("+59899123456")).toBe("+598 99 123 456")
  })
})

describe("fechas", () => {
  it("calcula días de la semana y lunes", () => {
    expect(weekdayOf("2026-11-02")).toBe(1)
    expect(startOfWeekDate("2026-11-08")).toBe("2026-11-02")
    expect(startOfWeekDate("2026-11-02")).toBe("2026-11-02")
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01")
  })
})

describe("horario semanal", () => {
  it("rechaza tramos que se pisan o terminan antes de empezar", () => {
    expect(
      weeklyHoursInput.safeParse([
        { weekday: 1, startTime: "09:00", endTime: "13:00" },
        { weekday: 1, startTime: "15:00", endTime: "20:00" },
        { weekday: 2, startTime: "09:00", endTime: "13:00" },
      ]).success,
    ).toBe(true)
    expect(
      weeklyHoursInput.safeParse([
        { weekday: 1, startTime: "09:00", endTime: "13:00" },
        { weekday: 1, startTime: "12:00", endTime: "20:00" },
      ]).success,
    ).toBe(false)
    expect(
      weeklyHoursInput.safeParse([{ weekday: 1, startTime: "13:00", endTime: "09:00" }]).success,
    ).toBe(false)
  })
})

describe("pasos del alta", () => {
  it("lista los pendientes disponibles y sigue al próximo", () => {
    expect(pendingSteps(["business"]).map((s) => s.key)).toEqual(["services", "team", "rules"])
    expect(pendingSteps(["business", "services", "team", "rules"])).toEqual([])
    expect(nextStepHref("services")).toBe("/onboarding/equipo")
    expect(nextStepHref("rules")).toBe("/onboarding/listo")
    expect(withCompleted(["business"], "business")).toEqual(["business"])
  })
})
