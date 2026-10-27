import { and, desc, eq, gte, isNull, sql } from "drizzle-orm"

import { replyContext } from "@/lib/bot/feedback"
import * as schema from "@/lib/db/schema"
import { forBusiness, forPlatform, type AnyDb } from "@/lib/db/scoped"
import { formatZoned } from "@/lib/time"

/*
 * Revisión semanal de los pilotos (docs/PILOTOS.md): un Markdown con cada
 * respuesta del bot marcada como "Mal" y cada respuesta que falló, con los
 * mensajes previos de la conversación. Sirve para ajustar el prompt, las
 * herramientas y las preguntas frecuentes, o para pegarlo en una sesión con
 * Claude. No lleva teléfonos ni nombres de clientes.
 */

const CONTEXT_MESSAGES = 6
const MAX_ITEMS_PER_BUSINESS = 30

const speaker = { cliente: "Cliente", bot: "Bot", equipo: "Equipo" } as const

export async function reviewMarkdown(db: AnyDb, since: Date, now: Date = new Date()): Promise<string> {
  const businesses = await forPlatform(db).businessesForAdmin()
  const sections: string[] = []
  let total = 0

  for (const { business } of businesses) {
    const scoped = forBusiness(db, business.id)
    const tz = business.timezone
    const [bad, failed] = await Promise.all([
      scoped.botFeedback.findMany({
        where: and(eq(schema.botFeedback.rating, "bad"), gte(schema.botFeedback.createdAt, since)),
        orderBy: desc(schema.botFeedback.createdAt),
        limit: MAX_ITEMS_PER_BUSINESS,
      }),
      scoped.messages.findMany({
        where: and(
          eq(schema.messages.direction, "outbound"),
          isNull(schema.messages.sentBy),
          gte(schema.messages.createdAt, since),
          sql`${schema.messages.toolTrace}->>'error' is not null`,
        ),
        orderBy: desc(schema.messages.createdAt),
        limit: MAX_ITEMS_PER_BUSINESS,
      }),
    ])
    const items = [
      ...bad.map((f) => ({ messageId: f.messageId, title: "Marcada como mala", note: f.note, error: null as string | null })),
      ...failed
        .filter((m) => !bad.some((f) => f.messageId === m.id))
        .map((m) => ({
          messageId: m.id,
          title: "Falló",
          note: null,
          error: (m.toolTrace as { error?: string } | null)?.error ?? null,
        })),
    ]
    if (items.length === 0) continue
    total += items.length

    const blocks: string[] = []
    for (const [index, item] of items.entries()) {
      const context = await replyContext(scoped, item.messageId, CONTEXT_MESSAGES)
      const reply = context.at(-1)
      const lines = [
        `### ${index + 1}. ${item.title}${reply ? ` · ${formatZoned(reply.at, tz, "d MMM HH:mm")}` : ""}`,
        "",
        ...context.map((m) => {
          const tools = m.tools.length ? ` _(herramientas: ${m.tools.join(", ")})_` : ""
          const text = m.text.replace(/\s*\n\s*/g, " / ") || "(sin texto)"
          return `- **${speaker[m.from]}:** ${text}${tools}`
        }),
      ]
      if (item.note) lines.push("", `> Tendría que haber dicho: ${item.note}`)
      if (item.error) lines.push("", `> Error: ${item.error}`)
      blocks.push(lines.join("\n"))
    }
    const kind = business.isDemo ? " (demo)" : business.pilotEndsAt ? " (piloto)" : ""
    sections.push(`## ${business.name}${kind}\n\n${blocks.join("\n\n")}`)
  }

  const header = [
    "# Revisión del bot",
    "",
    `Desde el ${formatZoned(since, "America/Montevideo", "d 'de' MMMM")} hasta el ${formatZoned(now, "America/Montevideo", "d 'de' MMMM 'de' yyyy")}. ${total === 0 ? "No hay respuestas marcadas ni con error." : `${total} ${total === 1 ? "respuesta para revisar" : "respuestas para revisar"}.`}`,
  ].join("\n")
  return [header, ...sections].join("\n\n") + "\n"
}
