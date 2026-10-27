"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { readOnlyFailure } from "@/lib/billing/access"
import { handleIncomingMessage } from "@/lib/bot/engine"
import {
  getTestConversation,
  loadTestChat,
  resetTestConversation,
  type ChatState,
} from "@/lib/bot/test-chat"
import * as schema from "@/lib/db/schema"
import { fail, invalid, ok, type ActionResult } from "@/lib/forms"
import { anthropicModel, isAnthropicConfigured } from "@/lib/integrations/anthropic/client"
import { withCompleted } from "@/lib/onboarding/steps"

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} es muy largo.` })
    .optional()
    .transform((v) => v || null)

const settingsInput = z.object({
  assistantName: z
    .string()
    .trim()
    .min(2, { error: "Escribí un nombre para el asistente." })
    .max(40, { error: "El nombre es muy largo." }),
  tone: z.enum(["informal", "formal"]),
  welcomeMessage: optionalText(500, "El mensaje de bienvenida"),
  faq: z
    .array(
      z.object({
        question: z
          .string()
          .trim()
          .min(3, { error: "Escribí la pregunta." })
          .max(200, { error: "La pregunta es muy larga." }),
        answer: z
          .string()
          .trim()
          .min(1, { error: "Escribí la respuesta." })
          .max(1000, { error: "La respuesta es muy larga." }),
      }),
    )
    .max(30, { error: "Podés cargar hasta 30 preguntas." }),
  replyHours: z.enum(["always", "business_hours"]),
  offHoursMessage: optionalText(500, "El mensaje fuera de horario"),
})

export type BotSettingsInput = z.input<typeof settingsInput>

export async function saveBotSettings(input: BotSettingsInput): Promise<ActionResult> {
  const tenant = await requirePermission("manageBot")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = settingsInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const existing = await tenant.db.botSettings.findFirst()
  if (existing) {
    await tenant.db.botSettings.update(eq(schema.botSettings.id, existing.id), parsed.data)
  } else {
    await tenant.db.botSettings.insert(parsed.data)
  }
  revalidatePath("/app/bot")
  return ok()
}

const automationsInput = z
  .object({
    reactivationEnabled: z.boolean(),
    reviewRequestEnabled: z.boolean(),
    reviewUrl: z
      .string()
      .trim()
      .max(500, { error: "El enlace es muy largo." })
      .transform((v) => v || null)
      .pipe(z.url({ protocol: /^https$/, error: "Pegá el enlace completo, que empiece con https://." }).nullable()),
    reviewDelayHours: z
      .number()
      .int()
      .refine((v) => [1, 2, 4, 24].includes(v), { error: "Elegí cuándo mandarlo." }),
  })
  .refine((v) => !v.reviewRequestEnabled || v.reviewUrl, {
    error: "Pegá el enlace para dejar la reseña.",
    path: ["reviewUrl"],
  })

export async function saveAutomations(input: z.input<typeof automationsInput>): Promise<ActionResult> {
  const tenant = await requirePermission("manageBot")
  const blocked = await readOnlyFailure(tenant.db)
  if (blocked) return blocked
  const parsed = automationsInput.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const existing = await tenant.db.botSettings.findFirst()
  if (existing) {
    await tenant.db.botSettings.update(eq(schema.botSettings.id, existing.id), parsed.data)
  } else {
    await tenant.db.botSettings.insert(parsed.data)
  }
  revalidatePath("/app/bot")
  return ok()
}

const messageInput = z
  .string()
  .trim()
  .min(1, { error: "Escribí un mensaje." })
  .max(2000, { error: "El mensaje es muy largo." })

export async function sendTestMessage(input: { text: string }): Promise<ActionResult<ChatState>> {
  const tenant = await requirePermission("manageBot")
  const text = messageInput.safeParse(input.text)
  if (!text.success) return fail(text.error.issues[0]?.message ?? "Escribí un mensaje.")
  if (!isAnthropicConfigured()) {
    return fail("El bot todavía no tiene la clave de Anthropic configurada (ANTHROPIC_API_KEY).")
  }

  const { conversation } = await getTestConversation(tenant.db, tenant.user.id)
  const result = await handleIncomingMessage({
    scoped: tenant.db,
    conversationId: conversation.id,
    text: text.data,
    channel: "test_chat",
    model: anthropicModel(),
  })

  if (result.status === "replied") {
    const business = await tenant.db.business()
    if (business && !business.onboardingCompleted.includes("test_bot")) {
      await tenant.db.updateBusiness({ onboardingCompleted: withCompleted(business.onboardingCompleted, "test_bot") })
    }
  }
  return ok(await loadTestChat(tenant.db, tenant.user.id))
}

export async function resetTestChat(): Promise<ActionResult<ChatState>> {
  const tenant = await requirePermission("manageBot")
  await resetTestConversation(tenant.db, tenant.user.id)
  revalidatePath("/app/agenda")
  return ok(await loadTestChat(tenant.db, tenant.user.id))
}
