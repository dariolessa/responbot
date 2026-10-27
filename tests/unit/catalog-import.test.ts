import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { handleIncomingMessage } from "@/lib/bot/engine"
import { getTestConversation } from "@/lib/bot/test-chat"
import * as schema from "@/lib/db/schema"
import type { StructuredModel } from "@/lib/integrations/anthropic/types"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { GraphError } from "@/lib/integrations/whatsapp/graph"
import { isPrivateAddress, PageFetchError, type PageFetcher } from "@/lib/integrations/web/fetch"
import { importSource, sourceKindFor } from "@/lib/listings/import"
import { catalogCaption, searchCatalog } from "@/lib/listings/items"
import { digestPage } from "@/lib/listings/page"
import { toOutboundPayload } from "@/lib/whatsapp/messages"
import { deliverMessage } from "@/lib/whatsapp/outbound"
import { createTestDb, type TestDb } from "../helpers/db"
import { lastToolResult, scriptedModel, seedSalon } from "../helpers/bot"

/*
 * Catálogo aprendido desde la web: lectura de páginas, importación con un
 * modelo simulado, búsqueda del bot y envío de fichas con foto.
 */

const SITE = "https://inmo.example.com"

const listingHtml = `<!doctype html><html><head><title>Propiedades | Inmo</title>
<meta property="og:image" content="/img/portada.jpg"></head><body>
<header><img src="/img/logo.png"><a href="/contacto">Contacto</a><a href="https://instagram.com/inmo">IG</a></header>
<script>var x = "<a href='/no'>no</a>"</script>
<div class="card"><a href="/propiedad/casa-carrasco"><img data-src="/fotos/casa1.jpg">Casa en Carrasco</a> US$ 320.000</div>
<div class="card"><a href="/propiedad/apto-pocitos">Apto en Pocitos</a><div style="background-image: url('/fotos/apto1.jpg')"></div> $ 25.000 / mes</div>
<script type="application/ld+json">{"@type":"ItemList","numberOfItems":2}</script>
</body></html>`

const detailHtml = (name: string) =>
  `<html><head><title>${name}</title></head><body><h1>${name}</h1><img srcset="/fotos/${name}-s.jpg 400w, /fotos/${name}-l.jpg 1200w"><p>3 dormitorios &amp; 2 baños</p></body></html>`

function fakeFetcher(pages: Record<string, string>): PageFetcher & { calls: string[] } {
  const calls: string[] = []
  const fetcher = async (url: string) => {
    calls.push(url)
    const html = pages[url]
    if (html === undefined) throw new PageFetchError(`404 ${url}`, "La página respondió con un error (404).")
    return { url, html }
  }
  return Object.assign(fetcher, { calls })
}

/** Modelo simulado: responde según la página que se le pasa en el prompt. */
function fakeExtractor(byUrl: (url: string, prompt: string) => unknown): StructuredModel & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async run({ prompt }) {
      prompts.push(prompt)
      const url = /^URL: (\S+)$/m.exec(prompt)?.[1] ?? ""
      return byUrl(url, prompt)
    },
  }
}

const twoListings = (gone = false) =>
  fakeExtractor((url) => {
    if (url === `${SITE}/propiedades`) {
      return {
        items: [
          { title: "Casa en Carrasco", price: 320000, currency: "USD", url: `${SITE}/propiedad/casa-carrasco`, image_indexes: [1] },
          ...(gone ? [] : [{ title: "Apto en Pocitos", url: `${SITE}/propiedad/apto-pocitos` }]),
        ],
        item_links: [
          `${SITE}/propiedad/casa-carrasco`,
          ...(gone ? [] : [`${SITE}/propiedad/apto-pocitos`]),
          "https://otro-sitio.com/inventado",
        ],
      }
    }
    if (url.endsWith("casa-carrasco")) {
      return {
        items: [
          {
            title: "Casa 3 dormitorios en Carrasco",
            description: "Casa con jardín y parrillero.",
            operation: "Venta",
            location: "Carrasco, Montevideo",
            attributes: [{ label: "Dormitorios", value: "3" }],
            image_indexes: [0, 99],
          },
        ],
      }
    }
    if (url.endsWith("apto-pocitos")) {
      return {
        items: [
          {
            title: "Apartamento 2 dormitorios en Pocitos",
            price: 25000,
            currency: "UYU",
            operation: "Alquiler",
            location: "Pocitos",
            image_indexes: [0],
          },
        ],
      }
    }
    return { items: [] }
  })

const pages = {
  [`${SITE}/propiedades`]: listingHtml,
  [`${SITE}/propiedad/casa-carrasco`]: detailHtml("casa"),
  [`${SITE}/propiedad/apto-pocitos`]: detailHtml("apto"),
}

let db: TestDb
let close: () => Promise<void>
let inmo: Awaited<ReturnType<typeof seedSalon>>
let other: Awaited<ReturnType<typeof seedSalon>>
let sourceId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  inmo = await seedSalon(db, "inmo")
  other = await seedSalon(db, "otro")
  const [source] = await inmo.scoped.catalogSources.insert({ url: `${SITE}/propiedades` })
  sourceId = source!.id
})

afterAll(async () => {
  await close()
})

describe("lectura de páginas", () => {
  it("saca texto, links del mismo sitio, fotos sin logos y JSON-LD", () => {
    const page = digestPage(listingHtml, `${SITE}/propiedades`)
    expect(page.title).toBe("Propiedades | Inmo")
    expect(page.links.map((l) => l.url)).toEqual([
      `${SITE}/contacto`,
      `${SITE}/propiedad/casa-carrasco`,
      `${SITE}/propiedad/apto-pocitos`,
    ])
    expect(page.images).toEqual([`${SITE}/img/portada.jpg`, `${SITE}/fotos/casa1.jpg`, `${SITE}/fotos/apto1.jpg`])
    expect(page.jsonLd).toEqual(['{"@type":"ItemList","numberOfItems":2}'])
    expect(page.text).toContain("US$ 320.000")
    expect(page.text).not.toContain("var x")
  })

  it("toma la foto más grande de un srcset y decodifica entidades", () => {
    const page = digestPage(detailHtml("casa"), `${SITE}/propiedad/casa-carrasco`)
    expect(page.images).toEqual([`${SITE}/fotos/casa-l.jpg`])
    expect(page.text).toContain("3 dormitorios & 2 baños")
  })

  it("no deja leer direcciones de la red interna", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false)
    expect(isPrivateAddress("2800:3f0:4001::200e")).toBe(false)
  })

  it("reconoce Instagram y MercadoLibre, que no se leen como web", () => {
    expect(sourceKindFor("https://www.instagram.com/inmo/")).toBe("instagram")
    expect(sourceKindFor("https://listado.mercadolibre.com.uy/_CustId_123")).toBe("mercadolibre")
    expect(sourceKindFor("https://www.mercadolibre.com.ar/perfil/INMO")).toBe("mercadolibre")
    expect(sourceKindFor(`${SITE}/propiedades`)).toBe("web")
  })
})

describe("importación", () => {
  it("lee el listado, abre cada ficha y guarda las publicaciones con sus fotos", async () => {
    const fetcher = fakeFetcher(pages)
    const result = await importSource(inmo.scoped, sourceId, { fetchPage: fetcher, model: twoListings() })
    expect(result).toEqual({ ok: true, found: 2, created: 2, updated: 0, hidden: 0 })
    // El link inventado por el modelo no se abre.
    expect(fetcher.calls).toEqual([
      `${SITE}/propiedades`,
      `${SITE}/propiedad/casa-carrasco`,
      `${SITE}/propiedad/apto-pocitos`,
    ])

    const items = await inmo.scoped.catalogItems.findMany({ orderBy: schema.catalogItems.title })
    expect(items.map((i) => i.title)).toEqual(["Apartamento 2 dormitorios en Pocitos", "Casa 3 dormitorios en Carrasco"])
    const casa = items[1]!
    // El precio sale del listado, el resto de la ficha; la foto 99 no existe y se descarta.
    expect(casa.price).toBe(32_000_000)
    expect(casa.currency).toBe("USD")
    expect(casa.imageUrls).toEqual([`${SITE}/fotos/casa-l.jpg`])
    expect(casa.attributes).toEqual([{ label: "Dormitorios", value: "3" }])
    expect(casa.url).toBe(`${SITE}/propiedad/casa-carrasco`)

    const source = await inmo.scoped.catalogSources.findById(sourceId)
    expect(source).toMatchObject({ status: "ok", itemCount: 2, lastError: null })
  })

  it("al reimportar actualiza, respeta lo editado a mano y oculta lo que ya no está", async () => {
    const casa = (await inmo.scoped.catalogItems.findFirst(eq(schema.catalogItems.operation, "Venta")))!
    await inmo.scoped.catalogItems.update(eq(schema.catalogItems.id, casa.id), {
      title: "Casa con jardín (precio negociable)",
      editedManually: true,
    })

    const result = await importSource(inmo.scoped, sourceId, { fetchPage: fakeFetcher(pages), model: twoListings(true) })
    expect(result).toEqual({ ok: true, found: 1, created: 0, updated: 0, hidden: 1 })

    const items = await inmo.scoped.catalogItems.findMany({ orderBy: schema.catalogItems.title })
    expect(items.map((i) => [i.title, i.available])).toEqual([
      ["Apartamento 2 dormitorios en Pocitos", false],
      ["Casa con jardín (precio negociable)", true],
    ])
  })

  it("si la página no responde, guarda el motivo en palabras y no toca las publicaciones", async () => {
    const result = await importSource(inmo.scoped, sourceId, { fetchPage: fakeFetcher({}), model: twoListings() })
    expect(result).toEqual({ ok: false, error: "La página respondió con un error (404)." })
    const source = await inmo.scoped.catalogSources.findById(sourceId)
    expect(source).toMatchObject({ status: "error", lastError: "La página respondió con un error (404)." })
    expect(await inmo.scoped.catalogItems.count(eq(schema.catalogItems.available, true))).toBe(1)
  })

  it("si no encuentra nada, no oculta lo que había", async () => {
    const empty = fakeExtractor(() => ({ items: [] }))
    const result = await importSource(inmo.scoped, sourceId, { fetchPage: fakeFetcher(pages), model: empty })
    expect(result.ok).toBe(false)
    expect(await inmo.scoped.catalogItems.count(eq(schema.catalogItems.available, true))).toBe(1)
  })

  it("Instagram queda con un aviso, sin intentar leerlo", async () => {
    const [ig] = await inmo.scoped.catalogSources.insert({ url: "https://instagram.com/inmo", kind: "instagram" })
    const fetcher = fakeFetcher(pages)
    const result = await importSource(inmo.scoped, ig!.id, { fetchPage: fetcher, model: twoListings() })
    expect(result.ok).toBe(false)
    expect(fetcher.calls).toEqual([])
  })

  it("cada negocio ve solo su catálogo", async () => {
    expect(await other.scoped.catalogItems.count()).toBe(0)
    expect(await importSource(other.scoped, sourceId, { fetchPage: fakeFetcher(pages), model: twoListings() })).toEqual({
      ok: false,
      error: "Esa fuente ya no existe.",
    })
  })
})

describe("búsqueda y fichas", () => {
  it("busca por palabras sin tildes ni plurales y filtra por precio en la misma moneda", async () => {
    await inmo.scoped.catalogItems.insert([
      { title: "Casa en Malvín", location: "Malvín", price: 25_000_000, currency: "USD", operation: "Venta" },
      { title: "Local comercial", location: "Centro", price: 4_000_000, currency: "UYU", operation: "Alquiler" },
    ])
    const casas = await searchCatalog(inmo.scoped, { query: "busco casas en malvin" })
    expect(casas.matches[0]!.title).toBe("Casa en Malvín")
    expect(casas.matches.map((m) => m.title)).toContain("Casa con jardín (precio negociable)")

    const cheap = await searchCatalog(inmo.scoped, { query: "casa", maxPrice: 30_000_000, currency: "USD" })
    expect(cheap.matches.map((m) => m.title)).toEqual(["Casa en Malvín"])
    const inPesos = await searchCatalog(inmo.scoped, { maxPrice: 5_000_000, currency: "UYU" })
    expect(inPesos.matches.map((m) => m.title)).toEqual(["Local comercial"])
  })

  it("el epígrafe entra en WhatsApp y lleva precio, zona y link", () => {
    const caption = catalogCaption({
      id: "x",
      businessId: "b",
      sourceId: null,
      externalKey: null,
      title: "Casa en Carrasco",
      description: "Muy linda. ".repeat(300),
      price: 32_000_000,
      currency: "USD",
      operation: "Venta",
      location: "Carrasco",
      attributes: [{ label: "Dormitorios", value: "3" }],
      imageUrls: [],
      url: `${SITE}/propiedad/casa-carrasco`,
      available: true,
      editedManually: false,
      lastSeenAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(caption.length).toBeLessThanOrEqual(1024)
    expect(caption).toMatch(/^\*Casa en Carrasco\*\nVenta · US\$\s320\.000\n📍 Carrasco\nDormitorios: 3/)
    expect(caption.endsWith(`${SITE}/propiedad/casa-carrasco`)).toBe(true)
  })
})

describe("el bot manda fichas", () => {
  it("busca, manda las fichas con foto antes de la respuesta y avisa en el prompt que hay catálogo", async () => {
    const { conversation } = await getTestConversation(inmo.scoped, inmo.owner.id)
    const model = scriptedModel([
      (request) => {
        expect(request.system[0]!.text).toContain("# Catálogo")
        return { tool: "search_catalog", input: { query: "casa carrasco" } }
      },
      (request) => {
        const { content } = lastToolResult(request) as { content: { results: { id: string; title: string }[] } }
        expect(content.results[0]!.title).toBe("Casa con jardín (precio negociable)")
        return { tool: "send_catalog_items", input: { item_ids: [content.results[0]!.id] } }
      },
      { text: "¿Te interesa? Si querés coordinamos una visita." },
    ])
    const result = await handleIncomingMessage({
      scoped: inmo.scoped,
      conversationId: conversation.id,
      text: "Hola, busco una casa en Carrasco",
      channel: "test_chat",
      model,
      now: (() => {
        let tick = 0
        return () => new Date(Date.parse("2026-11-02T13:00:00Z") + tick++ * 1000)
      })(),
    })
    expect(result.status).toBe("replied")
    const outbound = await inmo.scoped.messages.findMany({
      where: eq(schema.messages.direction, "outbound"),
      orderBy: [schema.messages.createdAt, schema.messages.id],
    })
    expect(outbound.map((m) => m.type)).toEqual(["image", "text"])
    expect(outbound[0]!.mediaUrl).toBe(`${SITE}/fotos/casa-l.jpg`)
    expect(outbound[0]!.body).toContain("Casa con jardín (precio negociable)")
    expect(outbound[1]!.body).toBe("¿Te interesa? Si querés coordinamos una visita.")
  })

  it("un negocio sin catálogo no recibe la sección en el prompt", async () => {
    const { conversation } = await getTestConversation(other.scoped, other.owner.id)
    const model = scriptedModel([
      (request) => {
        expect(request.system[0]!.text).not.toContain("# Catálogo")
        return { text: "¡Hola!" }
      },
    ])
    await handleIncomingMessage({
      scoped: other.scoped,
      conversationId: conversation.id,
      text: "Hola",
      channel: "test_chat",
      model,
      now: () => new Date("2026-11-02T13:00:00Z"),
    })
    expect(model.requests).toHaveLength(1)
  })

  it("en WhatsApp sale como imagen con epígrafe y, si la foto falla, como texto", async () => {
    const message = { body: "*Casa*\nUS$ 320.000", choices: null, type: "image", mediaUrl: `${SITE}/fotos/casa.jpg` }
    expect(toOutboundPayload(message)).toEqual({
      type: "image",
      image: { link: `${SITE}/fotos/casa.jpg`, caption: "*Casa*\nUS$ 320.000" },
    })

    const { conversation } = await getTestConversation(inmo.scoped, inmo.owner.id)
    const [row] = await inmo.scoped.messages.insert({
      conversationId: conversation.id,
      direction: "outbound",
      type: "image",
      body: "*Casa*\nUS$ 320.000",
      mediaUrl: `${SITE}/fotos/casa.jpg`,
      status: "queued",
    })
    const sent: OutboundPayload[] = []
    const api: WhatsAppApi = {
      async send(_to, payload) {
        sent.push(payload)
        if (payload.type === "image") throw new GraphError("Media download error", 400, 131053)
        return { wamid: "wamid.texto" }
      },
      async markRead() {},
      async downloadMedia() {
        throw new Error("no")
      },
    }
    const delivered = await deliverMessage(inmo.scoped, api, "+59899000000", row!)
    expect(sent.map((p) => p.type)).toEqual(["image", "text"])
    expect(delivered).toMatchObject({ status: "sent", wamid: "wamid.texto" })
  })
})
