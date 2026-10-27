"use client"

import { Copy, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { WeeklyRangeValue } from "@/lib/forms"
import { minutesToTime, timeToMinutes, weekdayLabels, weekdaysMondayFirst } from "@/lib/time"

/*
 * Horario semanal de un profesional: cada día abierto o cerrado, con uno o
 * más tramos (por ejemplo 9 a 13 y 15 a 20).
 */

function sortRanges(ranges: WeeklyRangeValue[]) {
  return [...ranges].sort(
    (a, b) => a.weekday - b.weekday || timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  )
}

export function WeeklyHoursEditor({
  value,
  onChange,
  error,
  idPrefix = "hours",
}: {
  value: WeeklyRangeValue[]
  onChange: (value: WeeklyRangeValue[]) => void
  error?: string
  idPrefix?: string
}) {
  const byDay = (day: number) => value.filter((r) => r.weekday === day)

  function setDay(day: number, ranges: WeeklyRangeValue[]) {
    onChange(sortRanges([...value.filter((r) => r.weekday !== day), ...ranges]))
  }

  function toggleDay(day: number, open: boolean) {
    if (!open) return setDay(day, [])
    // Al abrir un día se copia el primer día abierto, o 9 a 18.
    const template = weekdaysMondayFirst.map(byDay).find((r) => r.length > 0)
    setDay(
      day,
      template?.map((r) => ({ ...r, weekday: day })) ?? [
        { weekday: day, startTime: "09:00", endTime: "18:00" },
      ],
    )
  }

  function updateRange(day: number, index: number, patch: Partial<WeeklyRangeValue>) {
    setDay(
      day,
      byDay(day).map((r, i) => (i === index ? { ...r, ...patch } : r)),
    )
  }

  function addRange(day: number) {
    const ranges = byDay(day)
    const last = ranges.at(-1)
    const start = last ? Math.min(timeToMinutes(last.endTime) + 60, 22 * 60) : 9 * 60
    const end = Math.min(start + 4 * 60, 23 * 60 + 45)
    setDay(day, [...ranges, { weekday: day, startTime: minutesToTime(start), endTime: minutesToTime(end) }])
  }

  function copyToAll(fromDay: number) {
    const source = byDay(fromDay)
    const openDays = weekdaysMondayFirst.filter((d) => byDay(d).length > 0 || d === fromDay)
    onChange(
      sortRanges([
        ...value.filter((r) => !openDays.includes(r.weekday as (typeof openDays)[number])),
        ...openDays.flatMap((d) => source.map((r) => ({ ...r, weekday: d }))),
      ]),
    )
  }

  return (
    <div className="grid gap-1">
      {weekdaysMondayFirst.map((day) => {
        const ranges = byDay(day)
        const open = ranges.length > 0
        const checkboxId = `${idPrefix}-day-${day}`
        return (
          <div
            key={day}
            className="grid gap-2 border-b py-2 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:items-start"
          >
            <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-3 text-sm font-medium sm:min-h-9">
              <Checkbox
                id={checkboxId}
                checked={open}
                onChange={(e) => toggleDay(day, e.target.checked)}
              />
              {weekdayLabels[day]}
            </label>
            {open ? (
              <div className="grid gap-2">
                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      step={900}
                      aria-label={`${weekdayLabels[day]}, desde`}
                      value={range.startTime.slice(0, 5)}
                      onChange={(e) => updateRange(day, index, { startTime: e.target.value })}
                      className="w-32 font-mono"
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <Input
                      type="time"
                      step={900}
                      aria-label={`${weekdayLabels[day]}, hasta`}
                      value={range.endTime.slice(0, 5)}
                      onChange={(e) => updateRange(day, index, { endTime: e.target.value })}
                      className="w-32 font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar tramo"
                      onClick={() => setDay(day, ranges.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => addRange(day)}>
                    <Plus />
                    Agregar tramo
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copyToAll(day)}>
                    <Copy />
                    Copiar a los días abiertos
                  </Button>
                </div>
              </div>
            ) : (
              <p className="flex items-center text-sm text-muted-foreground sm:min-h-9">Cerrado</p>
            )}
          </div>
        )
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
