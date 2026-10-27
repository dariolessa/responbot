import { z } from "zod"

import { loadCatalog, openingHours } from "@/lib/bot/catalog"
import { formatDuration } from "@/lib/onboarding/templates"

import { defineTool } from "./define"

export const listServices = defineTool({
  name: "list_services",
  description:
    "Catálogo de servicios activos del negocio: id, nombre, descripción, duración, precio y qué profesionales lo hacen (con su precio y duración propios si cambian). Usala antes de nombrar un precio o una duración.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency)
    return {
      services: catalog.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        duration: formatDuration(s.durationMinutes),
        price: s.priceLabel,
        staff: s.staff.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.price !== s.price ? { price: p.priceLabel } : {}),
          ...(p.durationMinutes !== s.durationMinutes ? { duration: formatDuration(p.durationMinutes) } : {}),
        })),
      })),
    }
  },
})

export const listStaff = defineTool({
  name: "list_staff",
  description: "Profesionales del negocio, qué servicios hace cada uno y su horario semanal.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency)
    const serviceName = new Map(catalog.services.map((s) => [s.id, s.name]))
    return {
      staff: catalog.staff.map((p) => ({
        id: p.id,
        name: p.name,
        services: p.serviceIds.flatMap((id) => serviceName.get(id) ?? []),
        hours: openingHours([p]).filter((d) => d.hours !== "cerrado"),
      })),
    }
  },
})

export const getBusinessInfo = defineTool({
  name: "get_business_info",
  description:
    "Datos del negocio: nombre, dirección, horario de atención, políticas de reserva y cancelación, y preguntas frecuentes cargadas por el dueño. Si algo no está acá, no lo sabés.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency)
    const rules = ctx.rules
    return {
      name: ctx.business.name,
      address: ctx.business.address ?? "no está cargada",
      opening_hours: openingHours(catalog.staff),
      policies: {
        min_notice: rules ? formatDuration(rules.minNoticeMinutes) : null,
        max_days_ahead: rules?.maxDaysAhead ?? null,
        cancel_hours_before: rules?.cancelHours ?? null,
      },
      // Medios de pago y otras preguntas: lo que el dueño cargó como preguntas frecuentes.
      faq: ctx.settings?.faq ?? [],
    }
  },
})
