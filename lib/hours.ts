import { timeToMinutes, weekdayShortLabels, weekdaysMondayFirst } from "@/lib/time"

/** Resumen corto: "Lun a Vie 09:00–18:00 · Sáb 09:00–13:00". */
export function summarizeHours(ranges: { weekday: number; startTime: string; endTime: string }[]) {
  const dayText = (day: number) =>
    ranges
      .filter((r) => r.weekday === day)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
      .map((r) => `${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}`)
      .join(" y ")

  const groups: { days: number[]; text: string }[] = []
  for (const day of weekdaysMondayFirst) {
    const text = dayText(day)
    if (!text) continue
    const last = groups.at(-1)
    const prevDay = last?.days.at(-1)
    const consecutive = prevDay !== undefined && (prevDay === 6 ? day === 0 : day === prevDay + 1)
    if (last && last.text === text && consecutive) last.days.push(day)
    else groups.push({ days: [day], text })
  }
  if (groups.length === 0) return "Sin horario"
  return groups
    .map((g) =>
      g.days.length > 2
        ? `${weekdayShortLabels[g.days[0]!]} a ${weekdayShortLabels[g.days.at(-1)!]} ${g.text}`
        : `${g.days.map((d) => weekdayShortLabels[d]).join(" y ")} ${g.text}`,
    )
    .join(" · ")
}

/** Horario por defecto para un profesional nuevo: lunes a viernes 9 a 18, sábados 9 a 13. */
export function defaultWeeklyHours(): { weekday: number; startTime: string; endTime: string }[] {
  return [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "18:00" })),
    { weekday: 6, startTime: "09:00", endTime: "13:00" },
  ]
}
