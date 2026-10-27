import { eq } from "drizzle-orm";
import { z } from "zod";

import { loadCatalog, openingHours } from "@/lib/bot/catalog";
import * as schema from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/onboarding/templates";
import { depositFor } from "@/lib/payments/deposits";

import { defineTool, type ToolContext } from "./define";

async function takesDeposits(ctx: ToolContext): Promise<boolean> {
  return (
    ctx.channel === "whatsapp" &&
    Boolean(
      await ctx.scoped.mpAccounts.findFirst(
        eq(schema.mpAccounts.status, "active"),
      ),
    )
  );
}

export const listServices = defineTool({
  name: "list_services",
  description:
    "Catálogo de servicios activos del negocio: id, nombre, descripción, duración, precio y qué profesionales lo hacen (con su precio y duración propios si cambian). Usala antes de nombrar un precio o una duración.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency);
    const deposits = await takesDeposits(ctx);
    return {
      services: catalog.services.map((s) => {
        const deposit = deposits
          ? depositFor({
              rules: ctx.rules,
              price: s.price,
              depositOverride: s.depositOverride,
              customerNoShows: ctx.customer.noShowCount,
            })
          : 0;
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          duration: formatDuration(s.durationMinutes),
          price: s.priceLabel,
          ...(deposit > 0
            ? { deposit: formatMoney(deposit, ctx.business.currency) }
            : {}),
          staff: s.staff.map((p) => ({
            id: p.id,
            name: p.name,
            ...(p.price !== s.price ? { price: p.priceLabel } : {}),
            ...(p.durationMinutes !== s.durationMinutes
              ? { duration: formatDuration(p.durationMinutes) }
              : {}),
          })),
        };
      }),
    };
  },
});

export const listStaff = defineTool({
  name: "list_staff",
  description:
    "Profesionales del negocio, qué servicios hace cada uno y su horario semanal.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency);
    const serviceName = new Map(catalog.services.map((s) => [s.id, s.name]));
    return {
      staff: catalog.staff.map((p) => ({
        id: p.id,
        name: p.name,
        services: p.serviceIds.flatMap((id) => serviceName.get(id) ?? []),
        hours: openingHours([p]).filter((d) => d.hours !== "cerrado"),
      })),
    };
  },
});

/** La seña en palabras, o null si el negocio no cobra señas (o no conectó Mercado Pago). */
async function depositPolicy(ctx: ToolContext): Promise<string | null> {
  const rules = ctx.rules;
  if (!rules || !(await takesDeposits(ctx))) return null;
  const general =
    rules.depositMode === "fixed"
      ? `seña de ${formatMoney(rules.depositValue, ctx.business.currency)}`
      : rules.depositMode === "percent"
        ? `seña del ${rules.depositValue} % del precio`
        : null;
  const parts = [
    general
      ? `Para reservar se pide una ${general} (algunos servicios pueden tener otra; list_services la indica)`
      : "Algunos servicios piden seña para reservar (list_services la indica)",
    "se paga con Mercado Pago con un link que llega por WhatsApp",
    `el turno se guarda ${rules.holdMinutes} minutos esperando el pago`,
    `si se cancela con al menos ${rules.cancelHours} horas de anticipación, la seña se devuelve`,
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
}

export const getBusinessInfo = defineTool({
  name: "get_business_info",
  description:
    "Datos del negocio: nombre, dirección, horario de atención, políticas de reserva y cancelación, y preguntas frecuentes cargadas por el dueño. Si algo no está acá, no lo sabés.",
  input: z.object({}),
  async run(_input, ctx) {
    const catalog = await loadCatalog(ctx.scoped, ctx.business.currency);
    const rules = ctx.rules;
    return {
      name: ctx.business.name,
      address: ctx.business.address ?? "no está cargada",
      opening_hours: openingHours(catalog.staff),
      policies: {
        min_notice: rules ? formatDuration(rules.minNoticeMinutes) : null,
        max_days_ahead: rules?.maxDaysAhead ?? null,
        cancel_hours_before: rules?.cancelHours ?? null,
        deposit: await depositPolicy(ctx),
      },
      // Medios de pago y otras preguntas: lo que el dueño cargó como preguntas frecuentes.
      faq: ctx.settings?.faq ?? [],
    };
  },
});
