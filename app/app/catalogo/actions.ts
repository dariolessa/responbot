"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { readOnlyFailure } from "@/lib/billing/access"
import { audit } from "@/lib/catalog"
import * as schema from "@/lib/db/schema"
import { fail, invalid, ok, optionalMoneyInput, type ActionResult } from "@/lib/forms"
import { importDeps, importSoon } from "@/lib/listings/deps"
import { sourceKindFor } from "@/lib/listings/import"

/** Fuentes por negocio: alcanza para la web, un par de listados y las redes. */
const MAX_SOURCES = 10

const urlInput = z
  .string({ error: "Pegá la dirección." })
  .trim()
  .min(1, { error: "Pegá la dirección." })
  .max(2000)
  .transform((value, ctx) => {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
    try {
      const url = new URL(withScheme)
      if (!url.hostname.includes(".")) throw new Error("sin dominio")
      url.hash = ""
      return url.toString()
    } catch {
      ctx.addIssue({ code: "custom", message: "No parece una dirección web. Ejemplo: https://tuinmobiliaria.com/propiedades" })
      return z.NEVER
    }
  })

export async function addSource(input: { url: string }): Promise<ActionResult<schema.CatalogSource["kind"]>> {
  const tenant = await requirePermission("manageCatalog")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = z.object({ url: urlInput }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { url } = parsed.data

  if ((await tenant.db.catalogSources.count()) >= MAX_SOURCES) {
    return fail(`Podés cargar hasta ${MAX_SOURCES} direcciones. Borrá alguna para sumar otra.`)
  }
  if (await tenant.db.catalogSources.findFirst(eq(schema.catalogSources.url, url))) {
    return fail("Esa dirección ya está cargada.")
  }
  const kind = sourceKindFor(url)
  const deps = importDeps()
  if (kind !== "instagram" && !deps) return fail("Falta configurar la clave de Anthropic para leer publicaciones.")
  const blockedReason =
    kind === "instagram"
      ? "Para Instagram tocá \"Conectar Instagram\": su página no se puede leer desde afuera."
      : kind === "mercadolibre" && !deps?.mercadolibre
        ? "La lectura de MercadoLibre todavía no está habilitada."
        : null
  const [source] = await tenant.db.catalogSources.insert({
    url,
    kind,
    status: blockedReason ? "error" : "pending",
    lastError: blockedReason,
  })
  if (!blockedReason) importSoon(tenant.db.businessId, source!.id)
  revalidatePath("/app/catalogo")
  return ok(kind)
}

export async function reimportSource(input: { id: string }): Promise<ActionResult> {
  const tenant = await requirePermission("manageCatalog")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const { id } = z.object({ id: z.uuid() }).parse(input)
  const source = await tenant.db.catalogSources.findById(id)
  if (!source) return fail("Esa dirección ya no está cargada.")
  if (source.kind === "instagram" && !source.accessTokenEnc) return fail("Conectá la cuenta de Instagram para leerla.")
  if (!importDeps()) return fail("Falta configurar la clave de Anthropic para leer publicaciones.")
  await tenant.db.catalogSources.update(eq(schema.catalogSources.id, id), { status: "pending", lastError: null })
  importSoon(tenant.db.businessId, id)
  revalidatePath("/app/catalogo")
  return ok()
}

export async function deleteSource(input: { id: string }): Promise<ActionResult> {
  const tenant = await requirePermission("manageCatalog")
  const { id } = z.object({ id: z.uuid() }).parse(input)
  const [source] = await tenant.db.catalogSources.delete(eq(schema.catalogSources.id, id))
  if (source) {
    await audit(tenant.db, {
      actorId: tenant.user.id,
      action: "catalog.source_deleted",
      targetType: "catalog_source",
      targetId: id,
      metadata: { url: source.url, items: source.itemCount },
    })
  }
  revalidatePath("/app/catalogo")
  return ok()
}

/** "Dormitorios: 3" por renglón → atributos. */
function parseAttributes(text: string): schema.CatalogAttribute[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const at = line.indexOf(":")
      return at > 0
        ? { label: line.slice(0, at).trim().slice(0, 40), value: line.slice(at + 1).trim().slice(0, 80) }
        : { label: "Dato", value: line.slice(0, 80) }
    })
    .filter((a) => a.label && a.value)
}

const itemInput = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, { error: "Escribí un título." }).max(200),
  description: z.string().trim().max(2000),
  price: optionalMoneyInput,
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, { error: "Moneda de 3 letras: USD, UYU, ARS…" })
    .transform((v) => v.toUpperCase()),
  operation: z.string().trim().max(40),
  location: z.string().trim().max(200),
  attributes: z.string().max(4000),
  imageUrls: z
    .string()
    .max(10_000)
    .transform((text, ctx) => {
      const urls = text
        .split(/\s+/)
        .map((u) => u.trim())
        .filter(Boolean)
      for (const url of urls) {
        if (!/^https:\/\/[^\s]+$/i.test(url)) {
          ctx.addIssue({ code: "custom", message: "Cada foto tiene que ser un link que empiece con https://." })
          return z.NEVER
        }
      }
      return urls.slice(0, 10)
    }),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), { error: "El link tiene que empezar con https://." }),
  available: z.boolean(),
})

export async function saveItem(input: z.input<typeof itemInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageCatalog")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = itemInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { id, ...data } = parsed.data
  const values = {
    title: data.title,
    description: data.description || null,
    price: data.price,
    currency: data.price === null ? null : data.currency,
    operation: data.operation || null,
    location: data.location || null,
    attributes: parseAttributes(data.attributes),
    imageUrls: data.imageUrls,
    url: data.url || null,
    available: data.available,
    // Lo que el dueño corrige no lo pisa la próxima importación.
    editedManually: true,
  }
  if (id) {
    const [updated] = await tenant.db.catalogItems.update(eq(schema.catalogItems.id, id), values)
    if (!updated) return fail("Esa publicación ya no existe.")
  } else {
    await tenant.db.catalogItems.insert(values)
  }
  revalidatePath("/app/catalogo")
  return ok()
}

/** Pausar o volver a ofrecer sin tocar el resto de los datos. */
export async function setItemAvailable(input: { id: string; available: boolean }): Promise<ActionResult> {
  const tenant = await requirePermission("manageCatalog")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const { id, available } = z.object({ id: z.uuid(), available: z.boolean() }).parse(input)
  await tenant.db.catalogItems.update(eq(schema.catalogItems.id, id), { available, editedManually: true })
  revalidatePath("/app/catalogo")
  return ok()
}

export async function deleteItem(input: { id: string }): Promise<ActionResult> {
  const tenant = await requirePermission("manageCatalog")
  const { id } = z.object({ id: z.uuid() }).parse(input)
  const item = await tenant.db.catalogItems.findById(id)
  if (!item) return ok()
  if (item.sourceId) {
    // Si viene de la web, borrarla la haría volver en la próxima importación: queda oculta.
    await tenant.db.catalogItems.update(eq(schema.catalogItems.id, id), {
      available: false,
      editedManually: true,
    })
  } else {
    await tenant.db.catalogItems.delete(eq(schema.catalogItems.id, id))
  }
  revalidatePath("/app/catalogo")
  return ok()
}
