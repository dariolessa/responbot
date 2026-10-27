import { z } from "zod"

import type { StructuredModel } from "@/lib/integrations/anthropic/types"

import type { PageDigest } from "./page"

/*
 * Qué le pedimos al modelo de cada página: las publicaciones que muestra
 * (propiedades, productos, autos…) y, si es un listado, los links a cada
 * ficha. La respuesta vuelve por una herramienta y se valida con Zod.
 */

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? v.trim().slice(0, max) : null))

export const extractedItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  price: z.number().nonnegative().nullish().transform((v) => v ?? null),
  currency: optionalText(3).transform((v) => (v && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null)),
  operation: optionalText(40),
  location: optionalText(200),
  attributes: z
    .array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(80) }))
    .max(20)
    .nullish()
    .transform((v) => v ?? []),
  image_indexes: z
    .array(z.number().int().nonnegative())
    .max(20)
    .nullish()
    .transform((v) => v ?? []),
  url: optionalText(2000),
})

export const extractionSchema = z.object({
  items: z.array(z.unknown()).max(200).default([]),
  item_links: z.array(z.string()).max(200).nullish(),
})

export type ExtractedItem = z.output<typeof extractedItemSchema>

export type ExtractedPage = {
  items: (Omit<ExtractedItem, "image_indexes"> & { imageUrls: string[] })[]
  itemLinks: string[]
}

export const EXTRACT_TOOL = {
  name: "save_catalog",
  description: "Guarda las publicaciones encontradas en la página.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        description:
          "Publicaciones que la página muestra con datos propios (una por propiedad o producto). Vacío si no hay.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Título corto: tipo, ambientes o modelo y zona. Ej.: 'Casa 3 dormitorios en Carrasco'." },
            description: { type: "string", description: "Descripción en una o varias frases, sin inventar." },
            price: { type: "number", description: "Precio en unidades (no centésimos), sin símbolos. Omitir si dice 'consultar'." },
            currency: { type: "string", description: "Código ISO de la moneda del precio: USD, UYU, ARS…" },
            operation: { type: "string", description: "Venta, alquiler, alquiler temporario… si aplica." },
            location: { type: "string", description: "Barrio, ciudad o dirección tal como figura." },
            attributes: {
              type: "array",
              description: "Datos clave: dormitorios, baños, m², garage, año, estado…",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "string" } },
                required: ["label", "value"],
              },
            },
            image_indexes: {
              type: "array",
              items: { type: "integer" },
              description: "Números de las imágenes de la lista que son fotos de esta publicación (la principal primero).",
            },
            url: { type: "string", description: "Link a la ficha de esta publicación, de la lista de links. Omitir si no hay." },
          },
          required: ["title"],
        },
      },
      item_links: {
        type: "array",
        items: { type: "string" },
        description:
          "Solo en un listado: links (de la lista) que llevan a la ficha de cada publicación. Sin links de menús, filtros, contacto ni redes.",
      },
    },
    required: ["items"],
  },
}

const SYSTEM =
  "Extraés el catálogo de un negocio desde su página web para que un asistente de WhatsApp pueda ofrecerlo. Usás solo lo que dice la página: nunca inventes precios, datos ni fotos. Respondés siempre con la herramienta save_catalog."

export function extractionPrompt(page: PageDigest, mode: "listing" | "detail"): string {
  const task =
    mode === "detail"
      ? "Esta página es la ficha de UNA publicación. Devolvé esa publicación en items (una sola) con todos sus datos y sus fotos. Si no es una ficha (es un listado, un blog o una página institucional), devolvé items vacío."
      : "Esta página puede ser un listado de publicaciones o la ficha de una sola. Devolvé en items cada publicación que se vea con sus datos (título, precio, zona y foto principal si están). Si es un listado, devolvé además en item_links los links a la ficha de cada publicación."
  return [
    task,
    `URL: ${page.url}`,
    `Título: ${page.title}`,
    page.jsonLd.length ? `Datos estructurados (JSON-LD):\n${page.jsonLd.join("\n")}` : "",
    `Imágenes (número: url):\n${page.images.map((url, i) => `${i}: ${url}`).join("\n") || "(ninguna)"}`,
    `Links (url | texto):\n${page.links.map((l) => `${l.url} | ${l.text}`).join("\n") || "(ninguno)"}`,
    `Texto de la página:\n${page.text}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** Llama al modelo y valida la respuesta; descarta lo que no cierra en vez de fallar todo. */
export async function extractPage(
  model: StructuredModel,
  page: PageDigest,
  mode: "listing" | "detail",
): Promise<ExtractedPage> {
  const raw = await model.run({ system: SYSTEM, prompt: extractionPrompt(page, mode), tool: EXTRACT_TOOL })
  const parsed = extractionSchema.safeParse(raw)
  if (!parsed.success) return { items: [], itemLinks: [] }

  const known = new Set(page.links.map((l) => l.url))
  const items = parsed.data.items.flatMap((candidate) => {
    const item = extractedItemSchema.safeParse(candidate)
    if (!item.success) return []
    const { image_indexes, ...rest } = item.data
    const imageUrls = [...new Set(image_indexes.flatMap((i) => page.images[i] ?? []))]
    // Un link inventado no sirve: solo los de la página o la página misma.
    const url = rest.url && (known.has(rest.url) || rest.url === page.url) ? rest.url : mode === "detail" ? page.url : null
    return [{ ...rest, url, imageUrls }]
  })
  const itemLinks = [...new Set((parsed.data.item_links ?? []).filter((url) => known.has(url)))]
  return { items: mode === "detail" ? items.slice(0, 1) : items, itemLinks }
}
