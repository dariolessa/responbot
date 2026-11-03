import { randomBytes } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { encrypt } from "@/lib/crypto"
import * as schema from "@/lib/db/schema"
import type { OutboundPayload, WhatsAppApi } from "@/lib/integrations/whatsapp/client"
import { completeSignup } from "@/lib/integrations/whatsapp/signup"
import { parseWebhook, webhookPayload } from "@/lib/integrations/whatsapp/webhook"
import { requestAppSyncs, syncWindowOpen } from "@/lib/whatsapp/coexistence"
import { saveWhatsAppConnection } from "@/lib/whatsapp/connection"
import { processWebhookEvents, type WhatsAppDeps } from "@/lib/whatsapp/inbound"
import { loadThread } from "@/lib/whatsapp/inbox"
import { takeConversation } from "@/lib/whatsapp/panel"
import { createTestDb, type TestDb } from "../helpers/db"
import { scriptedModel, seedSalon, type Step } from "../helpers/bot"

/*
 * Coexistencia (app WhatsApp Business + Cloud API en el mismo número), sin
 * Meta: alta sin PIN, pedidos de contactos e historial, ecos de lo que el
 * dueño manda desde el celular y la pausa del bot.
 */

const KEY = randomBytes(32).toString("base64")
const PHONE_NUMBER_ID = "2223334445"
const CUSTOMER = "59899555666"

let db: TestDb
let close: () => Promise<void>
let salon: Awaited<ReturnType<typeof seedSalon>>
let sent: { to: string; payload: OutboundPayload }[]

const api: WhatsAppApi = {
  async send(to, payload) {
    sent.push({ to, payload })
    return { wamid: `wamid.out.${sent.length}.${Math.random()}` }
  },
  async markRead() {},
  async downloadMedia() {
    throw new Error("sin medios")
  },
}

function deps(steps: Step[], iso: string): WhatsAppDeps {
  let tick = 0
  const base = new Date(iso).getTime()
  return { api: () => api, model: scriptedModel(steps), transcriber: null, describer: null, now: () => new Date(base + tick++ * 1000) }
}

function change(field: string, value: Record<string, unknown>) {
  return webhookPayload.parse({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_C",
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "59829111000", phone_number_id: PHONE_NUMBER_ID },
              ...value,
            },
          },
        ],
      },
    ],
  })
}

let counter = 0
const customerText = (body: string) =>
  change("messages", {
    contacts: [{ wa_id: CUSTOMER, profile: { name: "Ana" } }],
    messages: [{ from: CUSTOMER, id: `wamid.c.${++counter}`, timestamp: "1793624400", type: "text", text: { body } }],
  })
const echo = (body: string, timestamp = "1793624460") =>
  change("smb_message_echoes", {
    message_echoes: [
      { from: "59829111000", to: CUSTOMER, id: `wamid.e.${++counter}`, timestamp, type: "text", text: { body } },
    ],
  })

async function run(payload: ReturnType<typeof change>, d: WhatsAppDeps) {
  await processWebhookEvents(db, parseWebhook(payload), d)
}

async function rows() {
  const customer = await salon.scoped.customers.findFirst(eq(schema.customers.phoneE164, `+${CUSTOMER}`))
  const conversation = customer
    ? await salon.scoped.conversations.findFirst(eq(schema.conversations.customerId, customer.id))
    : undefined
  const messages = conversation
    ? await salon.scoped.messages.findMany({
        where: eq(schema.messages.conversationId, conversation.id),
        orderBy: schema.messages.createdAt,
      })
    : []
  return { customer, conversation, messages }
}

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  salon = await seedSalon(db, "coexiste")
  await salon.scoped.whatsappAccounts.insert({
    wabaId: "WABA_C",
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhone: "+598 2911 1000",
    accessTokenEnc: encrypt("token", KEY),
    coexistence: true,
    coexistenceAt: new Date("2026-11-02T12:00:00Z"),
  })
})

beforeEach(async () => {
  sent = []
  const customer = await salon.scoped.customers.findFirst(eq(schema.customers.phoneE164, `+${CUSTOMER}`))
  if (customer) await salon.scoped.customers.delete(eq(schema.customers.id, customer.id))
})

afterAll(async () => {
  await close()
})

function fakeGraph(routes: Record<string, () => unknown>) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? "GET"
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const key = Object.keys(routes).find((k) => {
      const [m, path] = k.split(" ")
      return m === method && url.includes(path!)
    })
    if (!key) return new Response(JSON.stringify({ error: { message: "no", code: 100 } }), { status: 400 })
    return new Response(JSON.stringify(routes[key]!()), { status: 200 })
  }) as typeof fetch
  return { doFetch, calls }
}

describe("alta en modo coexistencia", () => {
  it("no registra el número, lo busca en la WABA si falta y guarda la marca", async () => {
    const { doFetch, calls } = fakeGraph({
      "GET oauth/access_token": () => ({ access_token: "EAAB-coexiste" }),
      "POST WABA_9/subscribed_apps": () => ({ success: true }),
      "GET WABA_9/phone_numbers": () => ({ data: [{ id: "99887766", display_phone_number: "+598 99 887 766" }] }),
      "GET 99887766?fields": () => ({ display_phone_number: "+598 99 887 766", verified_name: "Uñas Mar" }),
    })
    const result = await completeSignup(
      { code: "codigo-coexistencia", wabaId: "WABA_9", phoneNumberId: null, coexistence: true },
      { appId: "APP", appSecret: "s" },
      { version: "v23.0", fetch: doFetch },
    )
    expect(result).toMatchObject({ phoneNumberId: "99887766", coexistence: true, pin: null, registered: false })
    expect(calls.some((c) => c.url.includes("/register"))).toBe(false)

    const other = await seedSalon(db, "unas-mar")
    const now = new Date("2026-11-03T10:00:00Z")
    const account = await saveWhatsAppConnection(other.scoped, other.owner.id, result, (v) => encrypt(v, KEY), now)
    expect(account).toMatchObject({ coexistence: true, pinEnc: null, coexistenceAt: now, historySync: null })

    // Pide contactos y después historial; si el historial falla, se puede reintentar solo eso.
    const sync = fakeGraph({ "POST 99887766/smb_app_data": () => ({ request_id: "r1" }) })
    let failNext = true
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.sync_type === "history" && failNext) {
        failNext = false
        return new Response(JSON.stringify({ error: { message: "temporal", code: 1 } }), { status: 500 })
      }
      return sync.doFetch(input, init)
    }) as typeof fetch
    const failed = await requestAppSyncs(other.scoped, account, { version: "v23.0", token: "t", fetch: flaky }, now)
    expect(failed).toEqual(["history"])
    expect(sync.calls[0]!.body).toEqual({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" })
    let saved = (await other.scoped.whatsappAccounts.findFirst())!
    expect(saved).toMatchObject({ contactsSync: "requested", historySync: "failed" })

    await requestAppSyncs(other.scoped, saved, { version: "v23.0", token: "t", fetch: flaky }, now)
    saved = (await other.scoped.whatsappAccounts.findFirst())!
    expect(saved).toMatchObject({ contactsSync: "requested", historySync: "requested" })
    expect(sync.calls.map((c) => (c.body as { sync_type: string }).sync_type)).toEqual(["smb_app_state_sync", "history"])

    // Pasadas las 24 horas, Meta ya no lo acepta y no se pide.
    expect(syncWindowOpen(saved, new Date("2026-11-04T10:00:01Z"))).toBe(false)
  })
})

describe("mensajes desde el celular", () => {
  it("guarda el eco, calla al bot por unas horas y después vuelve", async () => {
    await run(customerText("Hola, ¿tienen turno?"), deps([{ text: "¡Hola Ana! Sí, ¿qué día?" }], "2026-11-02T13:00:00Z"))
    expect(sent).toHaveLength(1)

    // El dueño contesta desde la app del celular.
    await run(echo("Hola Ana, soy Caro. Te escribo yo."), deps([], "2026-11-02T13:01:00Z"))
    let { conversation, messages } = await rows()
    expect(messages.at(-1)).toMatchObject({ direction: "outbound", fromPhone: true, sentBy: null, body: "Hola Ana, soy Caro. Te escribo yo." })
    expect(conversation).toMatchObject({ mode: "human", lastMessagePreview: "Hola Ana, soy Caro. Te escribo yo." })
    expect(conversation!.humanUntil!.toISOString()).toBe("2026-11-03T01:01:00.000Z")

    // Un reintento del mismo eco no se guarda dos veces.
    const repeated = echo("otra vez")
    const wamid = (repeated.entry[0]!.changes[0]!.value as { message_echoes: { id: string }[] }).message_echoes[0]!.id
    await run(repeated, deps([], "2026-11-02T13:02:00Z"))
    await run(repeated, deps([], "2026-11-02T13:02:00Z"))
    expect((await rows()).messages.filter((m) => m.wamid === wamid)).toHaveLength(1)

    // Mientras dura la pausa, el bot no responde.
    await run(customerText("Dale, gracias"), deps([{ text: "no debería salir" }], "2026-11-02T14:00:00Z"))
    expect(sent).toHaveLength(1)

    const thread = await loadThread({ db: salon.scoped, role: "owner", user: salon.owner } as never, conversation!.id)
    expect(thread!.pausedUntil).toBe("2026-11-03T01:02:00.000Z")
    expect(thread!.messages.find((m) => m.body.startsWith("Hola Ana, soy Caro"))!.author).toBe("Desde el celular")

    // Pasada la pausa, el próximo mensaje lo responde el bot.
    await run(customerText("¿Me confirman?"), deps([{ text: "¡Claro! Te confirmo." }], "2026-11-03T02:00:00Z"))
    expect(sent).toHaveLength(2)
    ;({ conversation, messages } = await rows())
    expect(conversation).toMatchObject({ mode: "bot", humanUntil: null })
  })

  it("si la conversación la tomó alguien desde el panel, el eco no le pone vencimiento", async () => {
    await run(customerText("Hola"), deps([{ text: "Hola" }], "2026-11-02T13:00:00Z"))
    const { conversation } = await rows()
    await takeConversation(salon.scoped, conversation!.id, salon.owner.id)
    await run(echo("Te respondo yo"), deps([], "2026-11-02T13:05:00Z"))
    expect((await rows()).conversation).toMatchObject({ mode: "human", humanUntil: null, assignedTo: salon.owner.id })
  })
})

describe("historial y contactos de la app", () => {
  it("importa los chats viejos sin responder y respeta el rechazo", async () => {
    await run(
      change("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 40 },
            threads: [
              {
                id: CUSTOMER,
                messages: [
                  { from: CUSTOMER, id: "wamid.h.1", timestamp: "1780000000", type: "text", text: { body: "¿Abren el sábado?" }, history_context: { status: "READ" } },
                  { from: "59829111000", id: "wamid.h.2", timestamp: "1780000060", type: "text", text: { body: "Sí, de 9 a 13" }, history_context: { status: "READ" } },
                ],
              },
              { id: "120363000000000000@g.us", messages: [{ from: CUSTOMER, id: "wamid.h.g", timestamp: "1780000000", type: "text", text: { body: "grupo" } }] },
            ],
          },
        ],
      }),
      deps([], "2026-11-02T13:00:00Z"),
    )
    const { messages, conversation } = await rows()
    expect(messages.map((m) => [m.direction, m.body, m.status, m.fromPhone])).toEqual([
      ["inbound", "¿Abren el sábado?", "received", false],
      ["outbound", "Sí, de 9 a 13", "read", true],
    ])
    expect(conversation).toMatchObject({ mode: "bot", unreadCount: 0, lastMessagePreview: "Sí, de 9 a 13" })
    expect(sent).toHaveLength(0)
    expect(await salon.scoped.whatsappAccounts.findFirst()).toMatchObject({ historySync: "in_progress", historyProgress: 40 })

    await run(change("history", { history: [{ metadata: { progress: 100 }, threads: [] }] }), deps([], "2026-11-02T13:00:00Z"))
    expect(await salon.scoped.whatsappAccounts.findFirst()).toMatchObject({ historySync: "done", historyProgress: 100 })

    await run(
      change("history", { history: [{ errors: [{ code: 2593109, message: "History sharing is turned off" }] }] }),
      deps([], "2026-11-02T13:00:00Z"),
    )
    expect(await salon.scoped.whatsappAccounts.findFirst()).toMatchObject({ historySync: "declined" })
  })

  it("los contactos de la app pasan a Clientes sin pisar nombres ni borrar", async () => {
    const [existing] = await salon.scoped.customers.insert({ phoneE164: "+59899000111", name: "Marta" })
    await run(
      change("smb_app_state_sync", {
        state_sync: [
          { type: "contact", action: "add", contact: { full_name: "Ana Pérez", first_name: "Ana", phone_number: CUSTOMER }, metadata: { timestamp: "1780000000" } },
          { type: "contact", action: "add", contact: { full_name: "Marta Gómez", phone_number: "59899000111" } },
          { type: "contact", action: "remove", contact: { phone_number: "59899000111" } },
        ],
      }),
      deps([], "2026-11-02T13:00:00Z"),
    )
    expect((await rows()).customer).toMatchObject({ name: "Ana Pérez" })
    expect(await salon.scoped.customers.findById(existing!.id)).toMatchObject({ name: "Marta" })
    expect(await salon.scoped.whatsappAccounts.findFirst()).toMatchObject({ contactsSync: "done" })
  })
})
