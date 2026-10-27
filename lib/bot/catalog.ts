import { and, asc, eq } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import { formatMoney } from "@/lib/money"
import {
  minutesToTime,
  timeToMinutes,
  weekdayLabels,
  weekdaysMondayFirst,
  type DateString,
} from "@/lib/time"

/*
 * Catálogo del negocio tal como lo ve el bot: servicios activos con precio y
 * duración, profesionales con sus servicios y horarios. Lo usan el system
 * prompt (bloque fijo, cacheado) y las herramientas de consulta.
 */

export type CatalogService = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  priceLabel: string
  /** Seña propia del servicio en centésimos (0 = sin seña), o null si rige la general. */
  depositOverride: number | null
  staff: { id: string; name: string; durationMinutes: number; price: number; priceLabel: string }[]
}

export type CatalogStaff = {
  id: string
  name: string
  serviceIds: string[]
  hours: { weekday: number; startTime: string; endTime: string }[]
}

export type Catalog = {
  currency: string
  services: CatalogService[]
  staff: CatalogStaff[]
}

export async function loadCatalog(scoped: ScopedDb, currency: string): Promise<Catalog> {
  const [services, resources, links, hours] = await Promise.all([
    scoped.services.findMany({
      where: eq(schema.services.active, true),
      orderBy: [asc(schema.services.sortOrder), asc(schema.services.name)],
    }),
    scoped.resources.findMany({
      where: and(eq(schema.resources.active, true), eq(schema.resources.type, "staff")),
      orderBy: [asc(schema.resources.name)],
    }),
    scoped.resourceServices.findMany(),
    scoped.workingHours.findMany({
      orderBy: [asc(schema.workingHours.weekday), asc(schema.workingHours.startTime)],
    }),
  ])

  const activeStaff = new Map(resources.map((r) => [r.id, r]))

  return {
    currency,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      price: s.price,
      priceLabel: formatMoney(s.price, currency),
      depositOverride: s.depositOverride,
      staff: links
        .filter((l) => l.serviceId === s.id && activeStaff.has(l.resourceId))
        .map((l) => {
          const price = l.customPrice ?? s.price
          return {
            id: l.resourceId,
            name: activeStaff.get(l.resourceId)!.name,
            durationMinutes: l.customDuration ?? s.durationMinutes,
            price,
            priceLabel: formatMoney(price, currency),
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    staff: resources.map((r) => ({
      id: r.id,
      name: r.name,
      serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
      hours: hours
        .filter((h) => h.resourceId === r.id)
        .map((h) => ({
          weekday: h.weekday,
          startTime: h.startTime.slice(0, 5),
          endTime: h.endTime.slice(0, 5),
        })),
    })),
  }
}

/** Une tramos que se pisan o se tocan: [[9:00,13:00],[12:00,14:00]] → [[9:00,14:00]]. */
export function mergeRanges(ranges: { startTime: string; endTime: string }[]): string[] {
  const sorted = ranges
    .map((r) => [timeToMinutes(r.startTime), timeToMinutes(r.endTime)] as const)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged.map(([s, e]) => `${minutesToTime(s)} a ${minutesToTime(e)}`)
}

/** Horario de atención del local: la unión de los horarios del equipo, por día. */
export function openingHours(staff: CatalogStaff[]): { day: string; hours: string }[] {
  return weekdaysMondayFirst.map((weekday) => {
    const ranges = staff.flatMap((s) => s.hours.filter((h) => h.weekday === weekday))
    return {
      day: weekdayLabels[weekday],
      hours: ranges.length ? mergeRanges(ranges).join(" y ") : "cerrado",
    }
  })
}

/** ¿Está abierto en ese momento? (para "responder solo en horario de atención"). */
export function isWithinOpeningHours(
  staff: CatalogStaff[],
  weekday: number,
  minuteOfDay: number,
): boolean {
  return staff.some((s) =>
    s.hours.some(
      (h) =>
        h.weekday === weekday &&
        timeToMinutes(h.startTime) <= minuteOfDay &&
        minuteOfDay < timeToMinutes(h.endTime),
    ),
  )
}

export type { DateString }
