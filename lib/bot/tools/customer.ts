import { eq } from "drizzle-orm"
import { z } from "zod"

import * as schema from "@/lib/db/schema"

import { defineTool } from "./define"

export const saveCustomerName = defineTool({
  name: "save_customer_name",
  description:
    "Guarda el nombre del cliente cuando lo dice, y opcionalmente una preferencia que mencionó (por ejemplo 'prefiere a Ana' o 'pelo largo').",
  input: z.object({
    name: z.string().trim().min(2).max(80),
    preference: z.string().trim().max(200).optional(),
  }),
  async run(input, ctx) {
    const notes = input.preference
      ? [ctx.customer.notes, `Dijo por chat: ${input.preference}`].filter(Boolean).join("\n")
      : ctx.customer.notes
    const [updated] = await ctx.scoped.customers.update(eq(schema.customers.id, ctx.customer.id), {
      name: input.name,
      notes,
    })
    if (updated) ctx.customer = updated
    return { saved: true, name: input.name }
  },
})

export const handoffToHuman = defineTool({
  name: "handoff_to_human",
  description:
    "Pasa la conversación a una persona del equipo y le avisa. Usala ante enojo, reclamos, pedido explícito de hablar con alguien, temas que no son del negocio, datos que no tenés o después de tres intentos fallidos. Después de usarla, despedite diciendo que alguien del equipo le va a responder.",
  input: z.object({
    reason: z.string().trim().min(3).max(300).describe("Por qué se deriva, en una frase para el equipo."),
  }),
  async run(input, ctx) {
    const [conversation] = await ctx.scoped.conversations.update(
      eq(schema.conversations.id, ctx.conversation.id),
      { mode: "human", unreadCount: ctx.conversation.unreadCount + 1 },
    )
    if (conversation) ctx.conversation = conversation

    // Aviso en el panel para dueño y admins. Push, WhatsApp y correo llegan con el despachador (Fase 4).
    const members = await ctx.scoped.members()
    const recipients = members.filter((m) => m.active && (m.role === "owner" || m.role === "admin"))
    if (recipients.length) {
      await ctx.scoped.notifications.insert(
        recipients.map((m) => ({
          userId: m.userId,
          type: "conversation.handoff",
          payload: {
            conversationId: ctx.conversation.id,
            customerId: ctx.customer.id,
            customerName: ctx.customer.name,
            reason: input.reason,
            test: ctx.channel === "test_chat",
          },
          channels: ["in_app"],
        })),
      )
    }
    return {
      handed_off: true,
      hint: "Despedite en una frase: una persona del equipo le va a responder por acá.",
    }
  },
})
