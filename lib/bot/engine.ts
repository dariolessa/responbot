import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm"

import { openStatuses } from "@/lib/booking/policies"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import type { Anthropic, BotModel } from "@/lib/integrations/anthropic/types"
import { minutesOfDay, toDateString, weekdayOf } from "@/lib/time"

import { isWithinOpeningHours, loadCatalog } from "./catalog"
import { contextBlock, fixedBlock, systemBlocks } from "./prompts/system"
import { apiTools, runTool, type ToolContext } from "./tools"
import type { BotChannel } from "./tools/define"
import { addUsage, usagePeriod } from "./usage"

/*
 * Motor del bot (docs/SPEC.md, "Procesamiento de cada mensaje"). Atiende
 * WhatsApp (Fase 3) y el chat de prueba del panel con la misma lógica:
 *
 * 1. Guarda el mensaje entrante (el wamid único evita procesar dos veces).
 * 2. En modo humano no responde.
 * 3. Corta abusos: más de 20 mensajes por minuto del mismo cliente.
 * 4. Fuera del horario de respuesta, contesta el mensaje configurado.
 * 5. Toma el candado de la conversación (locked_until); si otro proceso la
 *    está atendiendo, ese proceso agrupa este mensaje en su próxima vuelta.
 * 6. Arma el contexto y deja que Claude use herramientas (máximo 6 vueltas y
 *    un tiempo máximo), guarda la respuesta con su traza y suma el consumo.
 */

export const MAX_TOOL_ROUNDS = 6
export const HISTORY_LIMIT = 20
export const RATE_LIMIT_PER_MINUTE = 20
const RESPONSE_DEADLINE_MS = 45_000
const LOCK_MS = 90_000
/** Vueltas extra para los mensajes que llegaron mientras se respondía. */
const MAX_PASSES = 3

export const FALLBACK_REPLY =
  "Perdón, tuve un problema para responderte. ¿Me lo repetís en un ratito? Si preferís, te paso con una persona del equipo."
export const DEFAULT_OFF_HOURS_MESSAGE =
  "¡Hola! Ahora estamos fuera de horario. Te respondemos apenas volvamos."

export type EngineStatus =
  | "replied"
  | "human"
  | "rate_limited"
  | "busy"
  | "off_hours"
  | "duplicate"
  | "auto_reply"

export type EngineResult = {
  status: EngineStatus
  inbound: schema.Message | null
  replies: schema.Message[]
}

export type HandleMessageInput = {
  scoped: ScopedDb
  conversationId: string
  /** Lo que el bot "lee": el texto, la transcripción del audio o la descripción de la imagen. */
  text: string
  channel: BotChannel
  model: BotModel
  /** Id de WhatsApp del mensaje (idempotencia). */
  wamid?: string
  /** Cómo se guarda el mensaje entrante si no es texto (audio, imagen, opción elegida). */
  stored?: {
    type: schema.Message["type"]
    body: string | null
    transcript?: string | null
    mediaId?: string | null
  }
  /** Respuesta fija sin llamar a la IA (baja de avisos, audio demasiado largo…). */
  autoReply?: string
  /** Se llama con cada respuesta guardada, para enviarla por WhatsApp apenas está lista. */
  onReply?: (message: schema.Message) => Promise<void>
  /** Reloj inyectable para los tests. */
  now?: () => Date
}

export type ToolTraceEntry = { name: string; input: unknown; ok: boolean; output: unknown }

export type MessageTrace = {
  model: string
  rounds: number
  tools: ToolTraceEntry[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  error?: string
}

/** Adelanto de la bandeja de conversaciones. */
export function previewOf(message: Pick<schema.Message, "body" | "transcript" | "type">): string {
  const text = (message.transcript ?? message.body ?? "").replace(/\s+/g, " ").trim()
  if (message.type === "audio") return `Audio: ${text}`.slice(0, 120)
  if (message.type === "image") return (text ? `Imagen: ${text}` : "Imagen").slice(0, 120)
  return text.slice(0, 120)
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; cause?: unknown }
    if (e.code === "23505") return true
    current = e.cause
  }
  return false
}

export async function handleIncomingMessage(input: HandleMessageInput): Promise<EngineResult> {
  const clock = input.now ?? (() => new Date())
  const { scoped } = input
  const now = clock()

  const conversation = await scoped.conversations.findById(input.conversationId)
  if (!conversation) throw new Error("bot: no existe la conversación")
  const business = await scoped.business()
  if (!business) throw new Error("bot: no existe el negocio")

  // 1. Guardar el mensaje entrante.
  let inbound: schema.Message
  try {
    ;[inbound] = (await scoped.messages.insert({
      conversationId: conversation.id,
      direction: "inbound",
      wamid: input.wamid ?? null,
      type: input.stored?.type ?? "text",
      body: input.stored ? input.stored.body : input.text,
      transcript: input.stored?.transcript ?? null,
      mediaId: input.stored?.mediaId ?? null,
      status: "received",
      // Con el reloj del motor: el candado, el límite y el orden del historial usan el mismo.
      createdAt: now,
    })) as [schema.Message]
  } catch (error) {
    if (input.wamid && isUniqueViolation(error)) return { status: "duplicate", inbound: null, replies: [] }
    throw error
  }

  const windowOpen =
    conversation.lastInboundAt && now.getTime() - conversation.lastInboundAt.getTime() < 24 * 3_600_000
  await scoped.conversations.update(eq(schema.conversations.id, conversation.id), {
    lastInboundAt: now,
    lastMessageAt: now,
    lastMessagePreview: previewOf(inbound),
    unreadCount: conversation.mode === "human" ? conversation.unreadCount + 1 : conversation.unreadCount,
  })
  // Una conversación facturable = una ventana de 24 horas abierta por el cliente. El chat de prueba no cuenta.
  if (input.channel === "whatsapp" && !windowOpen) {
    await addUsage(scoped, usagePeriod(now, business.timezone), { conversations: 1 })
  }

  // 2. Modo humano: el bot no responde.
  if (conversation.mode === "human") return { status: "human", inbound, replies: [] }

  // 3. Límite de frecuencia por cliente.
  const recent = await scoped.messages.count(
    and(
      eq(schema.messages.conversationId, conversation.id),
      eq(schema.messages.direction, "inbound"),
      gt(schema.messages.createdAt, new Date(now.getTime() - 60_000)),
    ),
  )
  if (recent > RATE_LIMIT_PER_MINUTE) return { status: "rate_limited", inbound, replies: [] }

  // Respuesta fija, sin IA.
  if (input.autoReply) {
    const reply = await saveReply(input, { text: input.autoReply, trace: null, at: clock() })
    return { status: "auto_reply", inbound, replies: [reply] }
  }

  // 4. Horario de respuesta.
  const settings = await scoped.botSettings.findFirst()
  if (settings?.replyHours === "business_hours") {
    const catalog = await loadCatalog(scoped, business.currency)
    const tz = business.timezone
    const open = isWithinOpeningHours(catalog.staff, weekdayOf(toDateString(now, tz)), minutesOfDay(now, tz))
    if (!open) {
      const text = settings.offHoursMessage?.trim() || DEFAULT_OFF_HOURS_MESSAGE
      // Un solo aviso por hora, aunque el cliente mande varios mensajes.
      const alreadyTold = await scoped.messages.findFirst(
        and(
          eq(schema.messages.conversationId, conversation.id),
          eq(schema.messages.direction, "outbound"),
          eq(schema.messages.body, text),
          gt(schema.messages.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      )
      if (alreadyTold) return { status: "off_hours", inbound, replies: [] }
      const reply = await saveReply(input, { text, trace: null, at: clock() })
      return { status: "off_hours", inbound, replies: [reply] }
    }
  }

  // 5. Candado por conversación.
  const [locked] = await scoped.conversations.update(
    and(
      eq(schema.conversations.id, conversation.id),
      or(isNull(schema.conversations.lockedUntil), lt(schema.conversations.lockedUntil, now)),
    ),
    { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  )
  if (!locked) return { status: "busy", inbound, replies: [] }

  const replies: schema.Message[] = []
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const reply = await runTurn({ ...input, now: clock(), clock }, business)
      if (reply) replies.push(reply.message)
      if (!reply || reply.humanMode) break
      // ¿Llegaron mensajes mientras respondíamos? Se contestan juntos en otra vuelta.
      const newer = await scoped.messages.findFirst(
        and(
          eq(schema.messages.conversationId, conversation.id),
          eq(schema.messages.direction, "inbound"),
          gt(schema.messages.createdAt, reply.answeredUpTo),
        ),
      )
      if (!newer) break
    }
  } finally {
    await scoped.conversations.update(eq(schema.conversations.id, conversation.id), { lockedUntil: null })
  }

  return { status: "replied", inbound, replies }
}

/** Historial reciente como mensajes de la API: alterna cliente y asistente, empieza por el cliente. */
export function historyToMessages(rows: schema.Message[]): Anthropic.Beta.BetaMessageParam[] {
  const out: { role: "user" | "assistant"; text: string }[] = []
  for (const row of rows) {
    const text = (row.transcript ?? row.body ?? "").trim()
    if (!text || row.type === "system") continue
    const role = row.direction === "inbound" ? "user" : "assistant"
    const last = out.at(-1)
    if (last && last.role === role) last.text += `\n${text}`
    else out.push({ role, text })
  }
  while (out[0] && out[0].role !== "user") out.shift()
  return out.map((m) => ({ role: m.role, content: m.text }))
}

async function runTurn(
  input: Omit<HandleMessageInput, "now"> & { now: Date; clock: () => Date },
  business: schema.Business,
): Promise<{ message: schema.Message; answeredUpTo: Date; humanMode: boolean } | null> {
  const { scoped, now } = input
  const conversation = await scoped.conversations.findById(input.conversationId)
  if (!conversation || conversation.mode === "human") return null
  const customer = await scoped.customers.findById(conversation.customerId)
  if (!customer) throw new Error("bot: no existe el cliente")

  const [rules, settings, catalog, upcomingRows] = await Promise.all([
    scoped.bookingRules.findFirst(),
    scoped.botSettings.findFirst(),
    loadCatalog(scoped, business.currency),
    scoped.bookings.findMany({
      where: and(
        eq(schema.bookings.customerId, customer.id),
        gte(schema.bookings.startsAt, now),
        inArray(schema.bookings.status, [...openStatuses]),
      ),
      orderBy: asc(schema.bookings.startsAt),
      limit: 5,
    }),
  ])

  const recent = await scoped.messages.findMany({
    where: eq(schema.messages.conversationId, conversation.id),
    orderBy: [desc(schema.messages.createdAt), desc(schema.messages.id)],
    limit: HISTORY_LIMIT,
  })
  const history = historyToMessages([...recent].reverse())
  if (history.length === 0) return null
  const firstMessage = !recent.some((m) => m.direction === "outbound")
  const answeredUpTo = recent.find((m) => m.direction === "inbound")?.createdAt ?? now

  const canBook = !(business.plan === "trial" && business.trialEndsAt && business.trialEndsAt < now)
  const serviceName = new Map(catalog.services.map((s) => [s.id, s.name]))
  const staffName = new Map(catalog.staff.map((s) => [s.id, s.name]))
  const system = systemBlocks(
    fixedBlock({ business, rules, settings, catalog }),
    contextBlock({
      business,
      customer,
      now,
      canBook,
      firstMessage,
      upcoming: upcomingRows.map((b) => ({
        service: serviceName.get(b.serviceId) ?? "Servicio",
        staff: staffName.get(b.resourceId) ?? "el equipo",
        startsAt: b.startsAt,
      })),
    }),
  )

  const ctx: ToolContext = {
    scoped,
    business,
    rules,
    settings,
    customer,
    conversation,
    channel: input.channel,
    now,
    canBook,
    choices: null,
  }

  const trace: MessageTrace = {
    model: input.model.name,
    rounds: 0,
    tools: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const messages = [...history]
  const deadline = Date.now() + RESPONSE_DEADLINE_MS
  let text = ""

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error("tiempo máximo de respuesta")
      const response = await input.model.create({ system, tools: apiTools, messages }, { timeoutMs: remaining })
      trace.rounds = round + 1
      trace.usage.input += response.usage.input_tokens
      trace.usage.output += response.usage.output_tokens
      trace.usage.cacheRead += response.usage.cache_read_input_tokens ?? 0
      trace.usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0

      if (response.stop_reason === "refusal") {
        trace.error = "refusal"
        break
      }

      // La respuesta vuelve completa (incluidos los bloques de razonamiento) para la siguiente vuelta.
      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] })
      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      )

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        text = response.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim()
        break
      }
      if (round === MAX_TOOL_ROUNDS) {
        trace.error = "demasiadas vueltas de herramientas"
        break
      }

      // En orden: dos herramientas que escriben en la base no se pisan.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const call of toolUses) {
        const result = await runTool(call.name, call.input, ctx)
        trace.tools.push({ name: call.name, input: call.input, ok: result.ok, output: result.output })
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result.output),
          is_error: !result.ok,
        })
      }
      messages.push({ role: "user", content: results })
    }
  } catch (error) {
    console.error("[bot] falló la respuesta", error)
    trace.error = error instanceof Error ? error.message : "error"
  }

  const humanMode = ctx.conversation.mode === "human"
  if (!text) {
    text = humanMode
      ? "Te paso con una persona del equipo, que te va a responder por acá."
      : FALLBACK_REPLY
  }

  // Al derivar no quedan opciones colgando: ya no responde el bot.
  const choices = humanMode ? null : ctx.choices
  const message = await saveReply(input, { text, trace, choices, at: input.clock() })
  await addUsage(scoped, usagePeriod(now, business.timezone), {
    aiInputTokens: trace.usage.input + trace.usage.cacheRead + trace.usage.cacheWrite,
    aiOutputTokens: trace.usage.output,
  })
  return { message, answeredUpTo, humanMode }
}

async function saveReply(
  input: Pick<HandleMessageInput, "scoped" | "conversationId" | "channel" | "onReply">,
  reply: { text: string; trace: MessageTrace | null; choices?: schema.MessageChoices | null; at: Date },
): Promise<schema.Message> {
  const { scoped, conversationId, channel } = input
  const [message] = await scoped.messages.insert({
    conversationId,
    direction: "outbound",
    type: reply.choices ? "interactive" : "text",
    body: reply.text,
    choices: reply.choices ?? null,
    // En WhatsApp queda en cola hasta que lo envía lib/whatsapp; en el chat de prueba ya se "entregó".
    status: channel === "whatsapp" ? "queued" : "sent",
    toolTrace: reply.trace,
    createdAt: reply.at,
  })
  await scoped.conversations.update(eq(schema.conversations.id, conversationId), {
    lastMessageAt: reply.at,
    lastMessagePreview: previewOf(message!),
  })
  if (input.onReply) {
    try {
      await input.onReply(message!)
    } catch (error) {
      // El envío marca el mensaje como fallido; el motor sigue.
      console.error("[bot] falló el envío de la respuesta", error)
    }
  }
  return message!
}
