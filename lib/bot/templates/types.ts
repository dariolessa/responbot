import type { archetypeEnum } from "@/lib/db/schema"

export type Archetype = (typeof archetypeEnum.enumValues)[number]

/** Texto del system prompt propio de un arquetipo (lib/bot/templates/<arquetipo>.ts). */
export type BotTemplate = {
  archetype: Archetype
  role(input: { assistantName: string; businessName: string }): string
  guidance: string
}
