"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { can } from "@/lib/auth/roles"
import { requirePermission } from "@/lib/auth/tenant"
import { clearBotRating, FeedbackError, rateBotReply } from "@/lib/bot/feedback"
import { agendaAccess } from "@/lib/booking/access"
import { fail, ok, type ActionResult } from "@/lib/forms"
import { apiFor } from "@/lib/whatsapp/deps"
import { canSeeConversation } from "@/lib/whatsapp/inbox"
import { InboxError, releaseConversation, sendPanelReply, takeConversation } from "@/lib/whatsapp/panel"

const idInput = z.uuid()
const rateInput = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  rating: z.enum(["good", "bad"]).nullable(),
  note: z.string().trim().max(1000, { error: "La nota es muy larga." }).nullable(),
})
const replyInput = z.object({
  conversationId: z.uuid(),
  text: z.string().trim().min(1, { error: "Escribí un mensaje." }).max(4000, { error: "El mensaje es muy largo." }),
})

async function visibleConversation(conversationId: unknown) {
  const tenant = await requirePermission("handleConversations")
  const id = idInput.safeParse(conversationId)
  if (!id.success) return { tenant, conversation: null }
  const access = await agendaAccess(tenant)
  const conversation = await canSeeConversation(tenant.db, access, tenant.user.id, id.data)
  return { tenant, conversation }
}

function refresh(id: string) {
  revalidatePath("/app/conversaciones")
  revalidatePath(`/app/conversaciones/${id}`)
}

export async function takeConversationAction(conversationId: string): Promise<ActionResult> {
  const { tenant, conversation } = await visibleConversation(conversationId)
  if (!conversation) return fail("No encontramos la conversación.")
  await takeConversation(tenant.db, conversation.id, tenant.user.id)
  refresh(conversation.id)
  return ok()
}

export async function releaseConversationAction(conversationId: string): Promise<ActionResult> {
  const { tenant, conversation } = await visibleConversation(conversationId)
  if (!conversation) return fail("No encontramos la conversación.")
  await releaseConversation(tenant.db, conversation.id)
  refresh(conversation.id)
  return ok()
}

export async function sendReplyAction(input: { conversationId: string; text: string }): Promise<ActionResult> {
  const parsed = replyInput.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Escribí un mensaje.")
  const { tenant, conversation } = await visibleConversation(parsed.data.conversationId)
  if (!conversation) return fail("No encontramos la conversación.")

  const account = await tenant.db.whatsappAccounts.findFirst()
  const api = account?.status === "active" ? apiFor(account) : null
  try {
    const message = await sendPanelReply(
      tenant.db,
      { conversationId: conversation.id, userId: tenant.user.id, text: parsed.data.text },
      api,
    )
    refresh(conversation.id)
    if (message.status === "failed") return fail("WhatsApp no aceptó el mensaje. Probá de nuevo en un rato.")
    return ok()
  } catch (error) {
    if (error instanceof InboxError) return fail(error.message)
    throw error
  }
}

/** Calificar una respuesta del bot (null la borra). Dueño y admins: es parte de ajustar el bot. */
export async function rateBotReplyAction(input: {
  conversationId: string
  messageId: string
  rating: "good" | "bad" | null
  note: string | null
}): Promise<ActionResult> {
  const parsed = rateInput.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "No se pudo guardar.")
  const { tenant, conversation } = await visibleConversation(parsed.data.conversationId)
  if (!conversation) return fail("No encontramos la conversación.")
  if (!can(tenant.role, "manageBot")) return fail("Solo el dueño o un admin pueden calificar al bot.")

  const message = await tenant.db.messages.findById(parsed.data.messageId)
  if (!message || message.conversationId !== conversation.id) return fail("No encontramos el mensaje.")
  try {
    if (parsed.data.rating === null) await clearBotRating(tenant.db, message.id)
    else {
      await rateBotReply(tenant.db, {
        messageId: message.id,
        rating: parsed.data.rating,
        note: parsed.data.note,
        userId: tenant.user.id,
      })
    }
  } catch (error) {
    if (error instanceof FeedbackError) return fail(error.message)
    throw error
  }
  refresh(conversation.id)
  revalidatePath("/app/bot")
  return ok()
}
