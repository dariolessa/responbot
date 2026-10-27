import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as schema from "@/lib/db/schema"
import type { StructuredModel } from "@/lib/integrations/anthropic/types"
import { InstagramError, type IgMedia, type InstagramApi } from "@/lib/integrations/instagram/api"
import {
  MercadoLibreError,
  parseStoreUrl,
  type MercadoLibreApi,
  type MlItem,
} from "@/lib/integrations/mercadolibre/api"
import type { PageFetcher } from "@/lib/integrations/web/fetch"
import { saveConnection } from "@/lib/listings/connections"
import { importSource } from "@/lib/listings/import"
import { postsDigest } from "@/lib/listings/instagram"
import { mlToFound } from "@/lib/listings/mercadolibre"
import { createTestDb, type TestDb } from "../helpers/db"
import { seedSalon } from "../helpers/bot"

/*
 * Catálogo desde MercadoLibre (API oficial, con y sin cuenta conectada) e
 * Instagram (cuenta conectada, el modelo arma las fichas desde cada post).
 */

const NOW = new Date("2026-11-02T13:00:00Z")
const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, "") }
const noFetch: PageFetcher = async (url) => {
  throw new Error(`no debería leer ${url}`)
}
const noModel: StructuredModel = {
  async run() {
    throw new Error("no debería llamar al modelo")
  },
}

const casa: MlItem = {
  id: "MLU111",
  title: "Casa en venta en Carrasco 3 dormitorios",
  price: 320000,
  currency_id: "USD",
  permalink: "https://casa.mercadolibre.com.uy/MLU-111-casa-carrasco",
  status: "active",
  seller_id: 777,
  pictures: [{ secure_url: "https://http2.mlstatic.com/casa-1.jpg" }, { secure_url: "https://http2.mlstatic.com/casa-2.jpg" }],
  attributes: [
    { id: "OPERATION", name: "Operación", value_name: "Venta" },
    { id: "TOTAL_AREA", name: "Área total", value_name: "450 m²" },
    { id: "BEDROOMS", name: "Dormitorios", value_name: "3" },
    { id: "ITEM_CONDITION", name: "Condición", value_name: "Usado" },
  ],
  location: { neighborhood: { name: "Carrasco" }, city: { name: "Montevideo" }, state: { name: "Montevideo" } },
}
const apto: MlItem = {
  id: "MLU222",
  title: "Apartamento en alquiler en Pocitos",
  price: 28000,
  currency_id: "UYU",
  permalink: "https://apartamento.mercadolibre.com.uy/MLU-222-apto-pocitos",
  status: "active",
  attributes: [{ id: "OPERATION", name: "Operación", value_name: "Alquiler" }],
  seller_address: { city: { name: "Pocitos" }, state: { name: "Montevideo" } },
}

type Calls = string[]

function fakeMl(overrides: Partial<MercadoLibreApi> = {}): MercadoLibreApi & { calls: Calls } {
  const calls: Calls = []
  return {
    calls,
    async appToken() {
      calls.push("appToken")
      return { access_token: "APP", expires_in: 21600 }
    },
    async exchangeCode() {
      throw new Error("no")
    },
    async refreshTokens(refresh) {
      calls.push(`refresh:${refresh}`)
      return { access_token: "SELLER2", refresh_token: "R2", expires_in: 21600 }
    },
    async me() {
      return { id: 777, nickname: "PUENTERURAL" }
    },
    async searchSellerItems(token, input) {
      calls.push(`search:${token}:${input.siteId}:${input.nickname ?? ""}:${input.sellerId ?? ""}`)
      return { sellerId: "777", ids: ["MLU111", "MLU222"] }
    },
    async userItems(token, userId) {
      calls.push(`userItems:${token}:${userId}`)
      return ["MLU111"]
    },
    async items(token, ids) {
      calls.push(`items:${token}:${ids.join(",")}`)
      return [casa, apto].filter((i) => ids.includes(i.id))
    },
    async description(_token, id) {
      return id === "MLU111" ? "Hermosa casa con jardín y piscina." : null
    },
    ...overrides,
  }
}

let db: TestDb
let close: () => Promise<void>
let inmo: Awaited<ReturnType<typeof seedSalon>>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  inmo = await seedSalon(db, "puente")
})

afterAll(async () => {
  await close()
})

describe("links de MercadoLibre", () => {
  it("reconoce la tienda, el perfil, el listado por vendedor y una publicación", () => {
    expect(
      parseStoreUrl(
        "https://listado.mercadolibre.com.uy/pagina/puenterural/#label=Inmuebles+recomendados&amp;component=tab-0&amp;tracking_id=95f4&amp;global_position=5",
      ),
    ).toEqual({ siteId: "MLU", nickname: "puenterural" })
    expect(parseStoreUrl("https://perfil.mercadolibre.com.ar/INMO.SUR")).toEqual({ siteId: "MLA", nickname: "INMO.SUR" })
    expect(parseStoreUrl("https://listado.mercadolibre.com.uy/_CustId_123456")).toEqual({ siteId: "MLU", sellerId: "123456" })
    expect(parseStoreUrl("https://casa.mercadolibre.com.uy/MLU-698765432-casa-en-carrasco-_JM")).toEqual({
      siteId: "MLU",
      itemId: "MLU698765432",
    })
    expect(parseStoreUrl("https://inmo.example.com/pagina/x")).toBeNull()
  })

  it("arma la ficha con precio, operación, zona, datos y fotos", () => {
    expect(mlToFound(casa, "Hermosa casa.")).toEqual({
      title: "Casa en venta en Carrasco 3 dormitorios",
      description: "Hermosa casa.",
      price: 320000,
      currency: "USD",
      operation: "Venta",
      location: "Carrasco, Montevideo",
      attributes: [
        { label: "Dormitorios", value: "3" },
        { label: "Área total", value: "450 m²" },
      ],
      imageUrls: ["https://http2.mlstatic.com/casa-1.jpg", "https://http2.mlstatic.com/casa-2.jpg"],
      url: "https://casa.mercadolibre.com.uy/MLU-111-casa-carrasco",
    })
    expect(mlToFound(apto, null).location).toBe("Pocitos, Montevideo")
  })
})

describe("importar desde MercadoLibre", () => {
  it("sin cuenta conectada busca la tienda del link con el token de la app", async () => {
    const [source] = await inmo.scoped.catalogSources.insert({
      kind: "mercadolibre",
      url: "https://listado.mercadolibre.com.uy/pagina/puenterural/",
    })
    const api = fakeMl()
    const result = await importSource(inmo.scoped, source!.id, {
      fetchPage: noFetch,
      model: noModel,
      mercadolibre: { api, ...crypto },
      now: () => NOW,
    })
    expect(result).toEqual({ ok: true, found: 2, created: 2, updated: 0, hidden: 0 })
    expect(api.calls).toEqual(["appToken", "search:APP:MLU:puenterural:", "items:APP:MLU111,MLU222"])

    const saved = await inmo.scoped.catalogSources.findById(source!.id)
    expect(saved).toMatchObject({ status: "ok", externalId: "777", itemCount: 2 })
    const items = await inmo.scoped.catalogItems.findMany({
      where: eq(schema.catalogItems.sourceId, source!.id),
      orderBy: schema.catalogItems.price,
    })
    expect(items.map((i) => [i.title, i.price, i.currency])).toEqual([
      ["Apartamento en alquiler en Pocitos", 2_800_000, "UYU"],
      ["Casa en venta en Carrasco 3 dormitorios", 32_000_000, "USD"],
    ])
    expect(items[1]!.description).toBe("Hermosa casa con jardín y piscina.")

    // La segunda vez ya busca por el id del vendedor.
    const again = fakeMl()
    await importSource(inmo.scoped, source!.id, { fetchPage: noFetch, model: noModel, mercadolibre: { api: again, ...crypto }, now: () => NOW })
    expect(again.calls[1]).toBe("search:APP:MLU::777")
  })

  it("si MercadoLibre no deja ver la tienda, pide conectar la cuenta", async () => {
    const [source] = await inmo.scoped.catalogSources.insert({
      kind: "mercadolibre",
      url: "https://listado.mercadolibre.com.uy/pagina/otra/",
    })
    const api = fakeMl({
      async searchSellerItems() {
        throw new MercadoLibreError("forbidden", 403)
      },
    })
    const result = await importSource(inmo.scoped, source!.id, { fetchPage: noFetch, model: noModel, mercadolibre: { api, ...crypto }, now: () => NOW })
    expect(result).toEqual({
      ok: false,
      error: "MercadoLibre no deja ver esa tienda desde afuera. Conectá la cuenta de MercadoLibre del negocio.",
    })
  })

  it("con la cuenta conectada lee sus publicaciones y renueva el token vencido", async () => {
    const source = await saveConnection(
      inmo.scoped,
      {
        kind: "mercadolibre",
        url: "https://perfil.mercadolibre.com.uy/PUENTERURAL",
        externalId: "777",
        accountName: "PUENTERURAL",
        accessToken: "SELLER1",
        refreshToken: "R1",
        expiresInSeconds: 60,
      },
      crypto,
      NOW,
    )
    // Se completó la fuente que ya tenía ese vendedor, no se creó otra.
    expect(source.url).toBe("https://listado.mercadolibre.com.uy/pagina/puenterural/")
    const api = fakeMl()
    const result = await importSource(inmo.scoped, source.id, { fetchPage: noFetch, model: noModel, mercadolibre: { api, ...crypto }, now: () => NOW })
    expect(result).toMatchObject({ ok: true, found: 1, hidden: 1 })
    expect(api.calls).toEqual(["refresh:R1", "userItems:SELLER2:777", "items:SELLER2:MLU111"])
    const saved = await inmo.scoped.catalogSources.findById(source.id)
    expect(saved?.accessTokenEnc).toBe("enc:SELLER2")
  })
})

describe("importar desde Instagram", () => {
  const posts: IgMedia[] = [
    {
      id: "1",
      media_type: "CAROUSEL_ALBUM",
      permalink: "https://www.instagram.com/p/AAA/",
      caption: "🏡 Casa en Punta Gorda, 4 dormitorios. US$ 480.000. Consultas por DM.",
      children: { data: [{ media_type: "IMAGE", media_url: "https://cdn.ig/aaa-1.jpg" }, { media_type: "IMAGE", media_url: "https://cdn.ig/aaa-2.jpg" }] },
    },
    { id: "2", media_type: "IMAGE", permalink: "https://www.instagram.com/p/BBB/", caption: "¡Feliz día del padre!", media_url: "https://cdn.ig/bbb.jpg" },
  ]

  function fakeIg(overrides: Partial<InstagramApi> = {}): InstagramApi & { refreshed: number } {
    const api = {
      refreshed: 0,
      async exchangeCode() {
        throw new Error("no")
      },
      async refresh() {
        api.refreshed++
        return { access_token: "IG2", expires_in: 5_184_000 }
      },
      async media(token: string) {
        expect(token).toBe("IG2")
        return posts
      },
      ...overrides,
    }
    return api
  }

  const model: StructuredModel = {
    async run({ prompt }) {
      expect(prompt).toContain("publicaciones de Instagram")
      expect(prompt).toContain("Imágenes: 0, 1")
      return {
        items: [
          {
            title: "Casa 4 dormitorios en Punta Gorda",
            price: 480000,
            currency: "USD",
            location: "Punta Gorda",
            image_indexes: [0, 1],
            url: "https://www.instagram.com/p/AAA/",
          },
          // Un link que no es de ningún post se descarta.
          { title: "Inventada", url: "https://www.instagram.com/p/ZZZ/" },
        ],
      }
    },
  }

  it("arma un lote con link, fotos y texto de cada post", () => {
    const digest = postsDigest("puenterural", posts)
    expect(digest.images).toEqual(["https://cdn.ig/aaa-1.jpg", "https://cdn.ig/aaa-2.jpg", "https://cdn.ig/bbb.jpg"])
    expect(digest.text).toContain("Link: https://www.instagram.com/p/BBB/\nImágenes: 2\nTexto: ¡Feliz día del padre!")
  })

  it("renueva el token si está por vencer y guarda las publicaciones que ofrecen algo", async () => {
    const source = await saveConnection(
      inmo.scoped,
      {
        kind: "instagram",
        url: "https://www.instagram.com/puenterural/",
        externalId: "178",
        accountName: "@puenterural",
        accessToken: "IG1",
        expiresInSeconds: 3 * 86_400,
      },
      crypto,
      NOW,
    )
    const api = fakeIg()
    const result = await importSource(inmo.scoped, source.id, {
      fetchPage: noFetch,
      model,
      instagram: { api, ...crypto },
      now: () => NOW,
    })
    expect(result).toEqual({ ok: true, found: 1, created: 1, updated: 0, hidden: 0 })
    expect(api.refreshed).toBe(1)
    const [item] = await inmo.scoped.catalogItems.findMany({ where: eq(schema.catalogItems.sourceId, source.id) })
    expect(item).toMatchObject({
      title: "Casa 4 dormitorios en Punta Gorda",
      price: 48_000_000,
      imageUrls: ["https://cdn.ig/aaa-1.jpg", "https://cdn.ig/aaa-2.jpg"],
      url: "https://www.instagram.com/p/AAA/",
    })
  })

  it("si Instagram revocó el permiso, borra el token y pide reconectar", async () => {
    const source = await inmo.scoped.catalogSources.findFirst(eq(schema.catalogSources.kind, "instagram"))
    await inmo.scoped.catalogSources.update(eq(schema.catalogSources.id, source!.id), { tokenExpiresAt: NOW })
    const api = fakeIg({
      async refresh() {
        throw new InstagramError("Error validating access token", 400, 190)
      },
    })
    const result = await importSource(inmo.scoped, source!.id, { fetchPage: noFetch, model, instagram: { api, ...crypto }, now: () => NOW })
    expect(result).toEqual({ ok: false, error: "Instagram se desconectó. Volvé a conectar la cuenta." })
    expect((await inmo.scoped.catalogSources.findById(source!.id))?.accessTokenEnc).toBeNull()
  })
})
