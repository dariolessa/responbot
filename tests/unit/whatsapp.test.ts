import { randomBytes } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { previewOf } from "@/lib/bot/engine"
import { decrypt, encrypt } from "@/lib/crypto"
import * as schema from "@/lib/db/schema"
import type { WhatsAppApi, OutboundPayload } from "@/lib/integrations/whatsapp/client"
import { GraphError } from "@/lib/integrations/whatsapp/graph"
import { parseSignedRequest } from "@/lib/integrations/whatsapp/signed-request"
import { completeSignup } from "@/lib/integrations/whatsapp/signup"
import { submitMissingTemplates, templateDefinitions } from "@/lib/integrations/whatsapp/templates"
import { parseWebhook, signBody, verifySignature, webhookPayload } from "@/lib/integrations/whatsapp/webhook"
import { audioDurationSeconds } from "@/lib/integrations/transcriber/duration"
import { saveWhatsAppConnection, removeWhatsAppConnection, ConnectionError } from "@/lib/whatsapp/connection"
import { processWebhookEvents, type WhatsAppDeps } from "@/lib/whatsapp/inbound"
import { listInbox, loadThread } from "@/lib/whatsapp/inbox"
import {
  AUDIO_TOO_LONG_REPLY,
  isWindowOpen,
  OPT_OUT_REPLY,
  optOutCommand,
  toOutboundPayload,
  UNSUPPORTED_REPLY,
} from "@/lib/whatsapp/messages"
import { shouldApplyStatus } from "@/lib/whatsapp/outbound"
import { InboxError, releaseConversation, sendPanelReply, takeConversation } from "@/lib/whatsapp/panel"
import { createStaff } from "@/lib/catalog"
import { createTestDb, type TestDb } from "../helpers/db"
import { scriptedModel, seedSalon, type Step } from "../helpers/bot"

/*
 * WhatsApp de punta a punta sin Meta: los eventos del webhook entran como los
 * manda Meta, el bot responde con un modelo con guion y los envíos quedan
 * registrados en una Cloud API simulada.
 */

const KEY = randomBytes(32).toString("base64")
const SECRET = "app-secret-de-prueba"
const PHONE_NUMBER_ID = "1098765432"

let db: TestDb
let close: () => Promise<void>
let salon: Awaited<ReturnType<typeof seedSalon>>

function fakeApi() {
  const sent: { to: string; payload: OutboundPayload }[] = []
  const read: { wamid: string; typing: boolean }[] = []
  const media = new Map<string, { data: Uint8Array; mimeType: string }>()
  let counter = 0
  let failNext: Error | null = null
  const api: WhatsAppApi = {
    async send(to, payload) {
      if (failNext) {
        const error = failNext
        failNext = null
        throw error
      }
      sent.push({ to, payload })
      return { wamid: `wamid.out.${++counter}` }
    },
    async markRead(wamid, options) {
      read.push({ wamid, typing: Boolean(options?.typing) })
    },
    async downloadMedia(id) {
      const found = media.get(id)
      if (!found) throw new GraphError("no existe", 404)
      return found
    },
  }
  return { api, sent, read, media, failNextWith: (e: Error) => (failNext = e) }
}

let wa: ReturnType<typeof fakeApi>

function clockFrom(iso = "2026-11-02T13:00:00Z") {
  let tick = 0
  const base = new Date(iso).getTime()
  return () => new Date(base + tick++ * 1000)
}

function deps(steps: Step[] = [], extra: Partial<WhatsAppDeps> = {}): WhatsAppDeps & { model: ReturnType<typeof scriptedModel> } {
  return {
    api: () => wa.api,
    model: scriptedModel(steps),
    transcriber: { name: "fake", transcribe: async () => "quiero un corte mañana" },
    describer: { describe: async () => "uñas largas con francesita blanca" },
    now: clockFrom(),
    ...extra,
  } as WhatsAppDeps & { model: ReturnType<typeof scriptedModel> }
}

let wamidCounter = 0

function payload(messages: Record<string, unknown>[], phoneNumberId = PHONE_NUMBER_ID, name = "Lucía") {
  return webhookPayload.parse({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "59829000000", phone_number_id: phoneNumberId },
              contacts: [{ wa_id: "59899111222", profile: { name } }],
              messages,
            },
          },
        ],
      },
    ],
  })
}

function textMessage(body: string, wamid = `wamid.in.${++wamidCounter}`) {
  return { from: "59899111222", id: wamid, timestamp: "1793624400", type: "text", text: { body } }
}

async function receive(messages: Record<string, unknown>[], d: WhatsAppDeps) {
  await processWebhookEvents(db, parseWebhook(payload(messages)), d)
}

async function conversationRows() {
  const customer = await salon.scoped.customers.findFirst(eq(schema.customers.phoneE164, "+59899111222"))
  if (!customer) return { customer: null, conversation: null, messages: [] }
  const conversation = await salon.scoped.conversations.findFirst(eq(schema.conversations.customerId, customer.id))
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
  salon = await seedSalon(db, "sol")
  await salon.scoped.whatsappAccounts.insert({
    wabaId: "WABA_1",
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhone: "+598 2900 0000",
    accessTokenEnc: encrypt("token-del-negocio", KEY),
  })
})

beforeEach(async () => {
  wa = fakeApi()
  // Cada test arranca sin el cliente de WhatsApp.
  const customer = await salon.scoped.customers.findFirst(eq(schema.customers.phoneE164, "+59899111222"))
  if (customer) {
    await salon.scoped.bookings.delete(eq(schema.bookings.customerId, customer.id))
    await salon.scoped.customers.delete(eq(schema.customers.id, customer.id))
  }
  await salon.scoped.whatsappAccounts.update(undefined, { status: "active" })
})

afterAll(async () => {
  await close()
})

describe("firma y lectura del webhook", () => {
  it("acepta solo el HMAC del cuerpo crudo con el app secret", () => {
    const body = JSON.stringify({ hola: "mundo" })
    const header = signBody(body, SECRET)
    expect(verifySignature(body, header, SECRET)).toBe(true)
    expect(verifySignature(body + " ", header, SECRET)).toBe(false)
    expect(verifySignature(body, header, "otro-secret")).toBe(false)
    expect(verifySignature(body, null, SECRET)).toBe(false)
    expect(verifySignature(body, "sha256=abc", SECRET)).toBe(false)
  })

  it("convierte mensajes, opciones, estados y avisos de cuenta en eventos", () => {
    const events = parseWebhook(
      webhookPayload.parse({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA_1",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: PHONE_NUMBER_ID },
                  contacts: [{ wa_id: "59899111222", profile: { name: "Lucía" } }],
                  messages: [
                    textMessage("Hola", "w1"),
                    { from: "59899111222", id: "w2", type: "audio", audio: { id: "m1", mime_type: "audio/ogg; codecs=opus", voice: true } },
                    { from: "59899111222", id: "w3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "opt_2", title: "Mar 3 · 09:00", description: "con Ana" } } },
                    { from: "59899111222", id: "w4", type: "button", button: { payload: "Confirmo", text: "Confirmo" } },
                    { from: "59899111222", id: "w5", type: "reaction", reaction: { emoji: "👍" } },
                    { from: "59899111222", id: "w6", type: "sticker", sticker: { id: "s1" } },
                  ],
                  statuses: [{ id: "wamid.out.1", status: "read" }, { id: "wamid.out.2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }],
                },
              },
              { field: "account_update", value: { event: "PARTNER_REMOVED" } },
            ],
          },
        ],
      }),
    )
    expect(events.map((e) => e.kind)).toEqual(["message", "message", "message", "message", "message", "status", "status", "account"])
    const [text, audio, choice, button, sticker] = events as Extract<(typeof events)[number], { kind: "message" }>[]
    expect(text).toMatchObject({ from: "59899111222", profileName: "Lucía", wamid: "w1", content: { type: "text", text: "Hola" } })
    expect(text!.at?.toISOString()).toBe("2026-11-02T13:00:00.000Z")
    expect(audio!.content).toEqual({ type: "audio", mediaId: "m1", mimeType: "audio/ogg; codecs=opus" })
    expect(choice!.content).toEqual({ type: "choice", id: "opt_2", title: "Mar 3 · 09:00", description: "con Ana" })
    expect(button!.content).toEqual({ type: "template_button", payload: "Confirmo", text: "Confirmo" })
    expect(sticker!.content).toEqual({ type: "unsupported", what: "sticker" })
    expect(events[6]).toMatchObject({ kind: "status", status: "failed", errorCode: 131047, error: "Re-engagement message" })
    expect(events[7]).toEqual({ kind: "account", wabaId: "WABA_1", event: "PARTNER_REMOVED" })
  })
})

describe("piezas sueltas", () => {
  it("cifra y descifra tokens; con otra clave falla", () => {
    const sealed = encrypt("EAAG-token", KEY)
    expect(sealed).not.toContain("EAAG")
    expect(decrypt(sealed, KEY)).toBe("EAAG-token")
    expect(() => decrypt(sealed, randomBytes(32).toString("base64"))).toThrow()
  })

  it("arma botones, listas o texto numerado según lo que entra", () => {
    const options = (n: number, description?: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `opt_${i + 1}`, title: `Opción ${i + 1}`, description }))

    expect(toOutboundPayload({ body: "Hola", choices: null })).toEqual({ type: "text", text: "Hola" })

    const buttons = toOutboundPayload({ body: "¿Qué servicio?", choices: { options: options(3) } })
    expect(buttons).toMatchObject({ type: "interactive", interactive: { type: "button" } })

    const list = toOutboundPayload({ body: "¿Qué horario?", choices: { button: "Ver horarios", options: options(5, "con Ana") } })
    expect(list).toMatchObject({
      type: "interactive",
      interactive: { type: "list", action: { button: "Ver horarios", sections: [{ rows: expect.any(Array) }] } },
    })

    // Con descripción ya no entra en botones: va como lista.
    expect(toOutboundPayload({ body: "x", choices: { options: options(2, "detalle") } })).toMatchObject({
      interactive: { type: "list" },
    })

    const long = toOutboundPayload({ body: "a".repeat(1100), choices: { options: options(2) } })
    expect(long.type).toBe("text")
    expect((long as { text: string }).text).toContain("\n1. Opción 1")
  })

  it("ventana de 24 horas, BAJA/ALTA y orden de estados", () => {
    const now = new Date("2026-11-02T13:00:00Z")
    expect(isWindowOpen(new Date("2026-11-01T14:00:00Z"), now)).toBe(true)
    expect(isWindowOpen(new Date("2026-11-01T12:59:00Z"), now)).toBe(false)
    expect(isWindowOpen(null, now)).toBe(false)

    expect(optOutCommand(" Baja ")).toBe("opt_out")
    expect(optOutCommand("ALTA!")).toBe("opt_in")
    expect(optOutCommand("quiero dar de baja el turno")).toBeNull()

    expect(shouldApplyStatus("sent", "delivered")).toBe(true)
    expect(shouldApplyStatus("read", "delivered")).toBe(false)
    expect(shouldApplyStatus("delivered", "failed")).toBe(true)
    expect(shouldApplyStatus("read", "failed")).toBe(false)
  })

  it("mide la duración de una nota de voz Ogg/Opus por su última página", () => {
    const page = (granule: bigint) => {
      const bytes = new Uint8Array(27)
      bytes.set([0x4f, 0x67, 0x67, 0x53], 0)
      new DataView(bytes.buffer).setBigUint64(6, granule, true)
      return bytes
    }
    const audio = new Uint8Array([...page(BigInt(48_000)), ...new Uint8Array(500), ...page(BigInt(48_000 * 95))])
    expect(audioDurationSeconds(audio, "audio/ogg")).toBe(95)
    // Sin páginas Ogg se estima por tamaño.
    expect(audioDurationSeconds(new Uint8Array(32_000), "audio/mpeg")).toBe(2)
  })

  it("verifica el signed_request de Meta", async () => {
    const { createHmac } = await import("node:crypto")
    const body = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "123" })).toString("base64url")
    const signature = createHmac("sha256", SECRET).update(body).digest("base64url")
    expect(parseSignedRequest(`${signature}.${body}`, SECRET)).toMatchObject({ user_id: "123" })
    expect(parseSignedRequest(`${signature}.${body}`, "otro")).toBeNull()
  })
})

describe("mensajes que entran por WhatsApp", () => {
  it("crea el cliente, responde con el bot y envía la respuesta", async () => {
    const d = deps([{ text: "¡Hola Lucía! ¿En qué te ayudo?" }])
    await receive([textMessage("Hola")], d)

    const { customer, conversation, messages } = await conversationRows()
    expect(customer).toMatchObject({ name: "Lucía", phoneE164: "+59899111222" })
    expect(messages.map((m) => [m.direction, m.body, m.status])).toEqual([
      ["inbound", "Hola", "received"],
      ["outbound", "¡Hola Lucía! ¿En qué te ayudo?", "sent"],
    ])
    expect(messages[1]!.wamid).toBe("wamid.out.1")
    expect(wa.sent).toEqual([{ to: "+59899111222", payload: { type: "text", text: "¡Hola Lucía! ¿En qué te ayudo?" } }])
    expect(wa.read).toEqual([{ wamid: messages[0]!.wamid, typing: true }])
    expect(conversation).toMatchObject({ mode: "bot", lastMessagePreview: "¡Hola Lucía! ¿En qué te ayudo?" })

    // Cuenta como conversación facturable de WhatsApp.
    const [usage] = await salon.scoped.usageCounters.findMany()
    expect(usage!.conversations).toBeGreaterThanOrEqual(1)
  })

  it("no procesa dos veces un reintento de Meta", async () => {
    const d = deps([{ text: "Hola" }])
    await receive([textMessage("Hola", "wamid.repetido")], d)
    await receive([textMessage("Hola", "wamid.repetido")], d)
    const { messages } = await conversationRows()
    expect(messages).toHaveLength(2)
    expect(d.model.requests).toHaveLength(1)
  })

  it("ignora eventos de un número que no está conectado", async () => {
    const d = deps()
    await processWebhookEvents(db, parseWebhook(payload([textMessage("Hola")], "999999")), d)
    expect((await conversationRows()).customer).toBeNull()
  })

  it("muestra opciones como lista y entiende la opción que toca el cliente", async () => {
    const d = deps([
      { tool: "show_choices", input: { button: "Ver horarios", options: [{ title: "Mar 3 · 09:00", description: "con Ana" }, { title: "Mar 3 · 09:30", description: "con Beto" }] } },
      { text: "¿Cuál te queda mejor?" },
      { text: "Perfecto, ¿te lo reservo?" },
    ])
    await receive([textMessage("Quiero un corte el martes")], d)
    expect(wa.sent[0]!.payload).toMatchObject({
      type: "interactive",
      interactive: { type: "list", body: { text: "¿Cuál te queda mejor?" }, action: { button: "Ver horarios" } },
    })

    await receive(
      [{ from: "59899111222", id: "wamid.choice", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "opt_1", title: "Mar 3 · 09:00", description: "con Ana" } } }],
      d,
    )
    const last = d.model.requests.at(-1)!
    expect(last.messages.at(-1)).toEqual({ role: "user", content: "Mar 3 · 09:00 (con Ana)" })
    const { messages } = await conversationRows()
    expect(messages[1]).toMatchObject({ type: "interactive", choices: { options: [{ id: "opt_1" }, { id: "opt_2" }] } })
    expect(messages[2]).toMatchObject({ type: "interactive", body: "Mar 3 · 09:00 (con Ana)" })
  })

  it("transcribe los audios y los trata como texto", async () => {
    wa.media.set("audio-1", { data: new Uint8Array(8_000), mimeType: "audio/ogg" })
    const d = deps([{ text: "¡Dale! ¿Con quién preferís?" }])
    await receive([{ from: "59899111222", id: "wamid.audio", type: "audio", audio: { id: "audio-1", mime_type: "audio/ogg; codecs=opus" } }], d)

    expect(d.model.requests[0]!.messages).toEqual([{ role: "user", content: "quiero un corte mañana" }])
    const { messages } = await conversationRows()
    expect(messages[0]).toMatchObject({ type: "audio", body: null, transcript: "quiero un corte mañana", mediaId: "audio-1" })
    expect(previewOf(messages[0]!)).toBe("Audio: quiero un corte mañana")
  })

  it("pide que escriba si el audio es demasiado largo, sin llamar a la IA", async () => {
    wa.media.set("audio-largo", { data: new Uint8Array(16_000 * 200), mimeType: "audio/mpeg" })
    const d = deps()
    await receive([{ from: "59899111222", id: "wamid.largo", type: "audio", audio: { id: "audio-largo", mime_type: "audio/mpeg" } }], d)
    expect(d.model.requests).toHaveLength(0)
    expect(wa.sent[0]!.payload).toEqual({ type: "text", text: AUDIO_TOO_LONG_REPLY })
  })

  it("describe las imágenes para el bot", async () => {
    wa.media.set("img-1", { data: new Uint8Array(10), mimeType: "image/jpeg" })
    const d = deps([{ text: "¡Qué lindas! Eso es Esculpidas." }])
    await receive([{ from: "59899111222", id: "wamid.img", type: "image", image: { id: "img-1", mime_type: "image/jpeg", caption: "¿Hacen estas?" } }], d)
    expect(d.model.requests[0]!.messages[0]!.content).toBe(
      "(Mandó una imagen: uñas largas con francesita blanca)\n¿Hacen estas?",
    )
    const { messages } = await conversationRows()
    expect(messages[0]).toMatchObject({ type: "image", body: "¿Hacen estas?" })
  })

  it("BAJA deja de mandar avisos y responde sin IA; lo que no puede leer, lo avisa", async () => {
    const d = deps()
    await receive([textMessage("BAJA")], d)
    expect((await conversationRows()).customer!.optedOut).toBe(true)
    expect(wa.sent.at(-1)!.payload).toEqual({ type: "text", text: OPT_OUT_REPLY })

    await receive([{ from: "59899111222", id: "wamid.sticker", type: "sticker", sticker: { id: "s" } }], d)
    expect(wa.sent.at(-1)!.payload).toEqual({ type: "text", text: UNSUPPORTED_REPLY })
    expect(d.model.requests).toHaveLength(0)
  })

  it("en modo humano guarda el mensaje, suma sin leer y no responde", async () => {
    const d = deps([{ text: "Hola" }])
    await receive([textMessage("Hola")], d)
    const { conversation } = await conversationRows()
    await takeConversation(salon.scoped, conversation!.id, salon.owner.id)

    await receive([textMessage("¿Me atiende alguien?")], d)
    const after = await conversationRows()
    expect(after.messages).toHaveLength(3)
    expect(after.conversation).toMatchObject({ mode: "human", unreadCount: 1 })
    expect(wa.sent).toHaveLength(1)
  })

  it("sin clave de IA, la conversación queda para una persona", async () => {
    const d = deps([], { model: null })
    await receive([textMessage("Hola")], d)
    const { conversation, messages } = await conversationRows()
    expect(conversation!.mode).toBe("human")
    expect(messages).toHaveLength(1)
    expect(wa.sent).toHaveLength(0)
  })

  it("actualiza estados sin retroceder y marca el token vencido si Meta lo rechaza", async () => {
    const d = deps([{ text: "Hola" }, { text: "Otra" }])
    await receive([textMessage("Hola")], d)
    const statuses = (status: string) =>
      webhookPayload.parse({
        object: "whatsapp_business_account",
        entry: [{ id: "WABA_1", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: "wamid.out.1", status }] } }] }],
      })
    await processWebhookEvents(db, parseWebhook(statuses("read")), d)
    await processWebhookEvents(db, parseWebhook(statuses("delivered")), d)
    const reply = await salon.scoped.messages.findFirst(eq(schema.messages.wamid, "wamid.out.1"))
    expect(reply!.status).toBe("read")

    wa.failNextWith(new GraphError("Error validating access token", 401, 190))
    await receive([textMessage("¿Siguen ahí?")], d)
    const { messages } = await conversationRows()
    expect(messages.at(-1)).toMatchObject({
      status: "failed",
      error: "Hay que volver a conectar WhatsApp desde Configuración.",
    })
    expect((await salon.scoped.whatsappAccounts.findFirst())!.status).toBe("token_expired")
  })
})

describe("bandeja de conversaciones", () => {
  it("lista, toma, responde dentro de la ventana y devuelve al bot", async () => {
    await receive([textMessage("Hola")], deps([{ text: "¡Hola!" }]))
    const { conversation } = await conversationRows()

    const tenant = { db: salon.scoped, role: "owner" as const, user: { id: salon.owner.id, email: "", name: null, image: null } }
    const items = await listInbox(tenant, "all")
    expect(items.map((i) => i.customerName)).toContain("Lucía")
    expect(await listInbox(tenant, "human")).toHaveLength(0)

    const now = new Date("2026-11-02T13:10:00Z")
    const sent = await sendPanelReply(salon.scoped, { conversationId: conversation!.id, userId: salon.owner.id, text: "Soy Marcela, te ayudo yo" }, wa.api, now)
    expect(sent).toMatchObject({ status: "sent", sentBy: salon.owner.id })
    expect(wa.sent.at(-1)!.payload).toEqual({ type: "text", text: "Soy Marcela, te ayudo yo" })
    const taken = await salon.scoped.conversations.findById(conversation!.id)
    expect(taken).toMatchObject({ mode: "human", assignedTo: salon.owner.id })
    expect((await listInbox(tenant, "human")).map((i) => i.assignedToMe)).toEqual([true])

    const thread = await loadThread(tenant, conversation!.id, now)
    expect(thread!.messages.map((m) => m.author)).toEqual([null, "bot", "sol@example.com"])
    expect(thread!.windowOpen).toBe(true)

    await expect(
      sendPanelReply(salon.scoped, { conversationId: conversation!.id, userId: salon.owner.id, text: "¿Seguís?" }, wa.api, new Date("2026-11-04T13:00:00Z")),
    ).rejects.toThrow(InboxError)

    const released = await releaseConversation(salon.scoped, conversation!.id)
    expect(released).toMatchObject({ mode: "bot", assignedTo: null })
  })

  it("un profesional ve solo las conversaciones de sus clientes o asignadas a él", async () => {
    await receive([textMessage("Hola")], deps([{ text: "¡Hola!" }]))
    const { conversation } = await conversationRows()
    const [staffUser] = await db.insert(schema.users).values({ email: "caro@example.com" }).returning()
    await salon.scoped.memberships.insert({ userId: staffUser!.id, role: "staff" })
    await createStaff(salon.scoped, { name: "Caro", serviceIds: [salon.corte.id], hours: [], userId: staffUser!.id })
    const staff = { db: salon.scoped, role: "staff" as const, user: { id: staffUser!.id, email: "caro@example.com", name: null, image: null } }

    expect(await listInbox(staff, "all")).toHaveLength(0)
    expect(await loadThread(staff, conversation!.id)).toBeNull()

    await takeConversation(salon.scoped, conversation!.id, staffUser!.id)
    expect((await listInbox(staff, "all")).map((i) => i.id)).toEqual([conversation!.id])
  })

  it("las conversaciones de otro negocio no aparecen", async () => {
    await receive([textMessage("Hola")], deps([{ text: "¡Hola!" }]))
    const other = await seedSalon(db, "otro-local")
    const tenant = { db: other.scoped, role: "owner" as const, user: { id: other.owner.id, email: "", name: null, image: null } }
    expect(await listInbox(tenant, "all")).toHaveLength(0)
    const { conversation } = await conversationRows()
    expect(await loadThread(tenant, conversation!.id)).toBeNull()
  })
})

describe("alta embebida y plantillas", () => {
  function fakeGraph(routes: Record<string, (init: RequestInit) => unknown>) {
    const calls: { method: string; url: string; body?: unknown }[] = []
    const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const key = Object.keys(routes).find((k) => {
        const [method, path] = k.split(" ")
        return method === (init.method ?? "GET") && url.includes(path!)
      })
      if (!key) return new Response(JSON.stringify({ error: { message: "no", code: 100 } }), { status: 400 })
      return new Response(JSON.stringify(routes[key]!(init)), { status: 200 })
    }) as typeof fetch
    return { doFetch, calls }
  }

  it("canjea el código, suscribe la app, registra el número y guarda todo cifrado", async () => {
    const { doFetch, calls } = fakeGraph({
      "GET oauth/access_token": () => ({ access_token: "EAAB-negocio" }),
      "POST WABA_2/subscribed_apps": () => ({ success: true }),
      "POST 5551234/register": () => ({ success: true }),
      "GET 5551234?fields": () => ({ display_phone_number: "+598 99 000 111", verified_name: "Barbería Norte" }),
    })
    const result = await completeSignup(
      { code: "codigo-de-meta-123", wabaId: "WABA_2", phoneNumberId: "5551234" },
      { appId: "APP", appSecret: SECRET },
      { version: "v23.0", fetch: doFetch },
    )
    expect(result).toMatchObject({ token: "EAAB-negocio", displayPhone: "+598 99 000 111", verifiedName: "Barbería Norte", registered: true })
    expect(result.pin).toMatch(/^\d{6}$/)
    expect(calls[0]!.url).toContain("client_secret=")
    expect(calls.find((c) => c.url.includes("register"))!.body).toEqual({ messaging_product: "whatsapp", pin: result.pin })

    const other = await seedSalon(db, "barberia-norte")
    const account = await saveWhatsAppConnection(other.scoped, other.owner.id, result, (v) => encrypt(v, KEY))
    expect(account.accessTokenEnc).not.toContain("EAAB")
    expect(decrypt(account.accessTokenEnc, KEY)).toBe("EAAB-negocio")
    expect((await other.scoped.business())!.onboardingCompleted).toContain("whatsapp")
    expect(await other.scoped.auditLogs.findFirst(eq(schema.auditLogs.action, "whatsapp.connected"))).toBeTruthy()

    // El mismo número no se puede conectar a otro negocio.
    const third = await seedSalon(db, "tercero")
    await expect(saveWhatsAppConnection(third.scoped, third.owner.id, result, (v) => encrypt(v, KEY))).rejects.toThrow(
      ConnectionError,
    )

    await removeWhatsAppConnection(other.scoped, other.owner.id)
    expect(await other.scoped.whatsappAccounts.findFirst()).toBeUndefined()
    expect((await other.scoped.business())!.onboardingCompleted).not.toContain("whatsapp")
  })

  it("sigue el alta aunque el número ya estuviera registrado", async () => {
    const { doFetch } = fakeGraph({
      "GET oauth/access_token": () => ({ access_token: "EAAB" }),
      "POST WABA_3/subscribed_apps": () => ({ success: true }),
      "GET 777?fields": () => ({ display_phone_number: "+598 99 777" }),
    })
    const result = await completeSignup(
      { code: "codigo-de-meta-456", wabaId: "WABA_3", phoneNumberId: "777" },
      { appId: "APP", appSecret: SECRET },
      { version: "v23.0", fetch: doFetch },
    )
    expect(result.registered).toBe(false)
  })

  it("manda a revisión solo las plantillas que faltan", async () => {
    const { doFetch, calls } = fakeGraph({
      "GET WABA_1/message_templates": () => ({
        data: [{ name: "recordatorio_turno", status: "APPROVED", language: "es_AR" }],
      }),
      "POST WABA_1/message_templates": () => ({ id: "1", status: "PENDING" }),
    })
    const result = await submitMissingTemplates("WABA_1", { version: "v23.0", token: "t", fetch: doFetch })
    expect(result.submitted).toHaveLength(templateDefinitions.length - 1)
    expect(result.submitted).not.toContain("recordatorio_turno")
    const created = calls.filter((c) => c.method === "POST").map((c) => c.body as { name: string; components: { type: string }[] })
    const reminder = templateDefinitions.find((t) => t.name === "lugar_liberado")!
    expect(created.find((c) => c.name === reminder.name)!.components.map((c) => c.type)).toEqual(["BODY", "BUTTONS"])
    // Cada variable tiene su ejemplo, como exige Meta.
    for (const t of templateDefinitions) {
      expect(t.body.match(/\{\{\d+\}\}/g)).toHaveLength(t.example.length)
    }
  })
})
