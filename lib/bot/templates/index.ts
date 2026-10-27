import { servicesTemplate } from "./services"
import type { Archetype, BotTemplate } from "./types"

const templates: Partial<Record<Archetype, BotTemplate>> = {
  services: servicesTemplate,
}

/** Plantilla del arquetipo; mientras no existan las otras, todos usan la de servicios. */
export function templateFor(archetype: Archetype): BotTemplate {
  return templates[archetype] ?? servicesTemplate
}
