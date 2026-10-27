import { eq } from "drizzle-orm"
import { z } from "zod"

import * as schema from "@/lib/db/schema"
import { notify } from "@/lib/notifications/dispatch"

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

    // Aviso a dueño y admins por el despachador (panel, push y WhatsApp); el chat de prueba solo avisa en el panel.
    const test = ctx.channel === "test_chat"
    await notify(ctx.scoped, {
      type: "conversation.handoff",
      payload: {
        conversationId: ctx.conversation.id,
        customerId: ctx.customer.id,
        customerName: ctx.customer.name,
        reason: input.reason,
        test,
      },
      inAppOnly: test,
      now: ctx.now,
    })
    return {
      handed_off: true,
      hint: "Despedite en una frase: una persona del equipo le va a responder por acá.",
    }
  },
})
