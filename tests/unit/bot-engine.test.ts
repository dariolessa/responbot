import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  FALLBACK_REPLY,
  handleIncomingMessage,
  historyToMessages,
  MAX_TOOL_ROUNDS,
  RATE_LIMIT_PER_MINUTE,
  type MessageTrace,
} from "@/lib/bot/engine"
import { getTestConversation, loadTestChat, resetTestConversation } from "@/lib/bot/test-chat"
import * as schema from "@/lib/db/schema"
import type { BotModel } from "@/lib/integrations/anthropic/types"
import { createTestDb, type TestDb } from "../helpers/db"
import { lastToolResult, scriptedModel, seedSalon } from "../helpers/bot"

/*
 * Motor del bot con un modelo simulado: el guion decide qué herramientas
 * pide "Claude" y el test revisa lo que el motor guarda y le manda.
 */

let db: TestDb
let close: () => Promise<void>
let salon: Awaited<ReturnType<typeof seedSalon>>
let conversationId: string

/** Reloj que avanza un segundo por lectura, desde el lunes 2/11 a las 10:00 de Montevideo. */
function clockFrom(iso = "2026-11-02T13:00:00Z") {
  let tick = 0
  const base = new Date(iso).getTime()
  return () => new Date(base + tick++ * 1000)
}

function send(text: string, model: BotModel, extra: { wamid?: string; now?: () => Date } = {}) {
  return handleIncomingMessage({
    scoped: salon.scoped,
    conversationId,
    text,
    channel: "test_chat",
    model,
    now: extra.now ?? clockFrom(),
    wamid: extra.wamid,
  })
}

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  salon = await seedSalon(db, "sol")
  conversationId = (await getTestConversation(salon.scoped, salon.owner.id)).conversation.id
})

beforeEach(async () => {
  await resetTestConversation(salon.scoped, salon.owner.id)
})

afterAll(async () => {
  await close()
})

describe("una respuesta con herramientas", () => {
  it("consulta, reserva y guarda la respuesta con su traza", async () => {
    const model = scriptedModel([
      { tool: "check_availability", input: { service_id: salon.corte.id, date_from: "2026-11-03" } },
      (request) => {
        const result = lastToolResult(request)
        expect(result.isError).toBe(false)
        const first = (result.content as { slots: { date: string; time: string; staff_id: string }[] }).slots[0]!
        return {
          tool: "create_booking",
          input: { service_id: salon.corte.id, staff_id: first.staff_id, date: first.date, time: first.time },
        }
      },
      { text: "¡Listo! Te reservé Corte con Ana el martes 3 a las 09:00." },
    ])

    const result = await send("Quiero un corte el martes temprano", model)
    expect(result.status).toBe("replied")
    expect(result.replies).toHaveLength(1)
    expect(result.replies[0]!.body).toBe("¡Listo! Te reservé Corte con Ana el martes 3 a las 09:00.")

    // El system prompt: bloque fijo cacheado con el catálogo y bloque variable con la fecha.
    const [first] = model.requests
    expect(first!.system[0]!.cache_control).toEqual({ type: "ephemeral" })
    expect(first!.system[0]!.text).toContain("Peluquería Sol")
    expect(first!.system[0]!.text).toContain(`Corte [id ${salon.corte.id}]`)
    expect(first!.system[0]!.text).not.toContain("2026-11-02")
    expect(first!.system[1]!.text).toContain("2026-11-02")
    expect(first!.system[1]!.text).toContain("Es el primer mensaje")
    expect(first!.tools).toHaveLength(11)
    expect(first!.messages).toEqual([{ role: "user", content: "Quiero un corte el martes temprano" }])

    // La vuelta siguiente recibe la respuesta del modelo y el resultado de la herramienta.
    expect(model.requests[1]!.messages).toHaveLength(3)

    const trace = result.replies[0]!.toolTrace as MessageTrace
    expect(trace.tools.map((t) => [t.name, t.ok])).toEqual([
      ["check_availability", true],
      ["create_booking", true],
    ])
    expect(trace.rounds).toBe(3)

    const bookings = await salon.scoped.bookings.findMany({ where: eq(schema.bookings.source, "test_chat") })
    expect(bookings.filter((b) => b.status === "confirmed")).toHaveLength(1)

    const [usage] = await salon.scoped.usageCounters.findMany()
    expect(usage).toMatchObject({ period: "2026-11", aiInputTokens: 450, aiOutputTokens: 60, conversations: 0 })

    // El candado queda libre.
    const conversation = await salon.scoped.conversations.findById(conversationId)
    expect(conversation!.lockedUntil).toBeNull()

    const chat = await loadTestChat(salon.scoped, salon.owner.id)
    expect(chat.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"])
    expect(chat.messages[1]!.tools.map((t) => t.name)).toEqual(["check_availability", "create_booking"])
  })

  it("manda el historial reciente y ya no es el primer mensaje", async () => {
    const now = clockFrom()
    await send("Hola", scriptedModel([{ text: "¡Hola! ¿En qué te ayudo?" }]), { now })
    const model = scriptedModel([{ text: "Sale $ 600." }])
    await send("¿Cuánto sale el corte?", model, { now })
    expect(model.requests[0]!.messages).toEqual([
      { role: "user", content: "Hola" },
      { role: "assistant", content: "¡Hola! ¿En qué te ayudo?" },
      { role: "user", content: "¿Cuánto sale el corte?" },
    ])
    expect(model.requests[0]!.system[1]!.text).not.toContain("Es el primer mensaje")
  })

  it("devuelve los errores de herramientas al modelo para que se corrija", async () => {
    const model = scriptedModel([
      { tool: "create_booking", input: { service_id: salon.corte.id, date: "2026-11-08", time: "10:00" } },
      (request) => {
        expect(lastToolResult(request).isError).toBe(true)
        return { text: "Ese día está cerrado. ¿Te sirve el lunes?" }
      },
    ])
    const result = await send("Turno el domingo a las 10", model)
    const trace = result.replies[0]!.toolTrace as MessageTrace
    expect(trace.tools[0]!.ok).toBe(false)
  })
})

describe("límites y fallas", () => {
  it(`corta después de ${MAX_TOOL_ROUNDS} vueltas de herramientas`, async () => {
    const loop = { tool: "list_services", input: {} }
    const model = scriptedModel(Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => loop))
    const result = await send("Hola", model)
    expect(model.requests).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(result.replies[0]!.body).toBe(FALLBACK_REPLY)
    expect((result.replies[0]!.toolTrace as MessageTrace).error).toMatch(/vueltas/)
  })

  it("si el modelo falla, responde un mensaje amable y libera el candado", async () => {
    const broken: BotModel = {
      name: "roto",
      create: async () => {
        throw new Error("sin conexión")
      },
    }
    const result = await send("Hola", broken)
    expect(result.replies[0]!.body).toBe(FALLBACK_REPLY)
    const conversation = await salon.scoped.conversations.findById(conversationId)
    expect(conversation!.lockedUntil).toBeNull()
  })

  it("no responde dos veces el mismo mensaje de WhatsApp", async () => {
    const model = scriptedModel([{ text: "¡Hola!" }])
    const first = await send("Hola", model, { wamid: "wamid.1" })
    const again = await send("Hola", model, { wamid: "wamid.1" })
    expect(first.status).toBe("replied")
    expect(again.status).toBe("duplicate")
    expect(model.requests).toHaveLength(1)
  })

  it("si otro proceso tiene el candado, guarda el mensaje y no responde", async () => {
    await salon.scoped.conversations.update(eq(schema.conversations.id, conversationId), {
      lockedUntil: new Date("2026-11-02T13:05:00Z"),
    })
    const model = scriptedModel([])
    const result = await send("¿Hola?", model)
    expect(result.status).toBe("busy")
    expect(result.inbound?.body).toBe("¿Hola?")
    expect(model.requests).toHaveLength(0)
  })

  it(`corta a quien manda más de ${RATE_LIMIT_PER_MINUTE} mensajes por minuto`, async () => {
    await salon.scoped.messages.insert(
      Array.from({ length: RATE_LIMIT_PER_MINUTE }, (_, i) => ({
        conversationId,
        direction: "inbound" as const,
        body: `spam ${i}`,
        status: "received" as const,
        createdAt: new Date(new Date("2026-11-02T12:59:30Z").getTime() + i * 100),
      })),
    )
    const model = scriptedModel([])
    const result = await send("uno más", model)
    expect(result.status).toBe("rate_limited")
    expect(model.requests).toHaveLength(0)
  })
})

describe("modo humano y horario", () => {
  it("después de derivar no responde más el bot", async () => {
    const model = scriptedModel([
      { tool: "handoff_to_human", input: { reason: "Quiere hacer un reclamo" } },
      { text: "Te paso con alguien del equipo." },
    ])
    const result = await send("Quiero hacer un reclamo", model)
    expect(result.replies[0]!.body).toBe("Te paso con alguien del equipo.")

    const silent = scriptedModel([])
    const next = await send("¿Hola?", silent)
    expect(next.status).toBe("human")
    expect(silent.requests).toHaveLength(0)
    const chat = await loadTestChat(salon.scoped, salon.owner.id)
    expect(chat.humanMode).toBe(true)
  })

  it("fuera de horario contesta el mensaje configurado, una vez", async () => {
    await salon.scoped.botSettings.update(undefined, {
      replyHours: "business_hours",
      offHoursMessage: "Estamos cerrados, te escribimos mañana.",
    })
    try {
      // Lunes a las 22:00 de Montevideo.
      const night = clockFrom("2026-11-03T01:00:00Z")
      const model = scriptedModel([])
      const first = await send("Hola", model, { now: night })
      expect(first.status).toBe("off_hours")
      expect(first.replies[0]!.body).toBe("Estamos cerrados, te escribimos mañana.")
      const second = await send("¿Hay alguien?", model, { now: night })
      expect(second.replies).toHaveLength(0)
      expect(model.requests).toHaveLength(0)
    } finally {
      await salon.scoped.botSettings.update(undefined, { replyHours: "always" })
    }
  })

  it("con la prueba vencida avisa al modelo que no reserve", async () => {
    await salon.scoped.updateBusiness({ trialEndsAt: new Date("2026-11-01T00:00:00Z") })
    try {
      const model = scriptedModel([{ text: "Por ahora te ayudo con consultas." }])
      await send("Quiero un turno", model)
      expect(model.requests[0]!.system[1]!.text).toContain("no toma reservas")
    } finally {
      await salon.scoped.updateBusiness({ trialEndsAt: new Date("2026-12-31T00:00:00Z") })
    }
  })
})

describe("chat de prueba", () => {
  it("empezar de nuevo borra mensajes, cancela turnos y vuelve al bot", async () => {
    const model = scriptedModel([
      { tool: "save_customer_name", input: { name: "Lucía" } },
      { tool: "create_booking", input: { service_id: salon.color.id, date: "2026-11-05", time: "15:00" } },
      { tool: "handoff_to_human", input: { reason: "Prueba" } },
      { text: "Listo." },
    ])
    await send("Soy Lucía, quiero color el jueves 15:00", model)
    const { cancelledBookings } = await resetTestConversation(salon.scoped, salon.owner.id)
    expect(cancelledBookings).toBe(1)
    const chat = await loadTestChat(salon.scoped, salon.owner.id)
    expect(chat).toEqual({ messages: [], humanMode: false })
    const { customer } = await getTestConversation(salon.scoped, salon.owner.id)
    expect(customer).toMatchObject({ name: null, isTest: true })
  })
})

describe("historyToMessages", () => {
  const row = (direction: "inbound" | "outbound", body: string, type = "text") =>
    ({ direction, body, type, transcript: null }) as schema.Message

  it("une mensajes seguidos del mismo lado y empieza por el cliente", () => {
    expect(
      historyToMessages([
        row("outbound", "Recordatorio"),
        row("inbound", "Hola"),
        row("inbound", "¿Están?"),
        row("outbound", "¡Sí!"),
        row("outbound", "", "system"),
      ]),
    ).toEqual([
      { role: "user", content: "Hola\n¿Están?" },
      { role: "assistant", content: "¡Sí!" },
    ])
  })
})
