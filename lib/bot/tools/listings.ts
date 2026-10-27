import { z } from "zod"

import { availableItems, priceLabel, searchCatalog } from "@/lib/listings/items"

import { defineTool, ToolError } from "./define"

/*
 * Catálogo aprendido desde la web del negocio (docs/CATALOGO.md): propiedades,
 * productos, autos. search_catalog busca; send_catalog_items manda las fichas
 * con foto antes de la próxima respuesta.
 */

export const MAX_CARDS = 3

export const searchCatalogTool = defineTool({
  name: "search_catalog",
  description:
    "Busca en el catálogo del negocio (propiedades, productos o lo que publique en su web): devuelve las publicaciones disponibles que coinciden, con id, título, precio, operación, zona y datos clave. Usala cuando el cliente pregunte qué hay disponible o busque algo concreto. Si total es 0, el negocio no tiene catálogo cargado.",
  input: z.object({
    query: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Palabras clave de lo que busca: tipo, zona, ambientes, operación. Ej.: 'casa 3 dormitorios Carrasco alquiler'."),
    max_price: z.number().positive().optional().describe("Precio máximo en unidades (no centésimos)."),
    min_price: z.number().positive().optional().describe("Precio mínimo en unidades."),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
      .describe("Moneda de max_price/min_price (USD, UYU, ARS…). Si no se dice, la del negocio."),
  }),
  async run(input, ctx) {
    const currency = (input.currency ?? ctx.business.currency).toUpperCase()
    const { total, matches } = await searchCatalog(ctx.scoped, {
      query: input.query,
      maxPrice: input.max_price === undefined ? null : Math.round(input.max_price * 100),
      minPrice: input.min_price === undefined ? null : Math.round(input.min_price * 100),
      currency,
    })
    return {
      total,
      results: matches.map((item) => ({
        id: item.id,
        title: item.title,
        price: priceLabel(item),
        operation: item.operation,
        location: item.location,
        details: item.attributes.slice(0, 8).map((a) => `${a.label}: ${a.value}`),
        summary: item.description ? item.description.slice(0, 280) : null,
        photos: item.imageUrls.length,
        link: item.url,
      })),
      hint:
        matches.length === 0 && total > 0
          ? "No hay coincidencias: decíselo y ofrecé buscar con otros datos (otra zona, otro precio) o pasarle con una persona."
          : undefined,
    }
  },
})

export const sendCatalogItems = defineTool({
  name: "send_catalog_items",
  description: `Manda al cliente hasta ${MAX_CARDS} fichas del catálogo (foto, precio, zona, datos y link), cada una como un mensaje aparte, justo antes de tu próxima respuesta. Usala después de search_catalog con los id que mejor le sirven. En tu respuesta no repitas los datos de las fichas: hacé una pregunta corta (si le interesa alguna, si quiere coordinar una visita, si busca otra cosa).`,
  input: z.object({
    item_ids: z.array(z.uuid()).min(1).max(MAX_CARDS),
  }),
  async run(input, ctx) {
    const items = await availableItems(ctx.scoped, [...new Set(input.item_ids)])
    if (items.length === 0) throw new ToolError("Esas publicaciones ya no están disponibles. Buscá de nuevo con search_catalog.")
    const already = new Set(ctx.cards)
    for (const item of items) if (!already.has(item.id) && ctx.cards.length < MAX_CARDS) ctx.cards.push(item.id)
    return {
      queued: items.map((i) => i.title),
      hint: "Las fichas salen antes de tu respuesta. Escribí solo una frase o pregunta corta, sin repetir sus datos.",
    }
  },
})
