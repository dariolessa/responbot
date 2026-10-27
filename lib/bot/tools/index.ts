import {
  cancelBookingTool,
  checkAvailability,
  createBookingTool,
  getCustomerBookings,
  joinWaitlist,
  rescheduleBooking,
} from "./bookings"
import { getBusinessInfo, listServices, listStaff } from "./catalog"
import { showChoices } from "./choices"
import { handoffToHuman, saveCustomerName } from "./customer"
import { searchCatalogTool, sendCatalogItems } from "./listings"
import { toApiTool, ToolError, type BotTool, type ToolContext } from "./define"

/**
 * Las once herramientas del SPEC más show_choices (mensajes interactivos) y las
 * del catálogo (search_catalog, send_catalog_items), en
 * un orden fijo: el orden forma parte del prefijo cacheado.
 */
export const botTools: BotTool[] = [
  listServices,
  listStaff,
  checkAvailability,
  createBookingTool,
  getCustomerBookings,
  rescheduleBooking,
  cancelBookingTool,
  joinWaitlist,
  getBusinessInfo,
  saveCustomerName,
  handoffToHuman,
  showChoices,
  searchCatalogTool,
  sendCatalogItems,
] as BotTool[]

export const apiTools = botTools.map(toApiTool)

const byName = new Map(botTools.map((t) => [t.name, t]))

export type ToolCallResult = { ok: boolean; output: unknown }

/**
 * Valida la entrada con Zod y ejecuta la herramienta. Los errores esperables
 * (entrada inválida, horario ocupado) vuelven al modelo para que se corrija;
 * los inesperados se registran y también vuelven, sin detalles internos.
 */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolCallResult> {
  const tool = byName.get(name)
  if (!tool) return { ok: false, output: { error: `No existe la herramienta ${name}.` } }

  const parsed = tool.input.safeParse(input ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      output: { error: "Datos inválidos.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
    }
  }
  try {
    return { ok: true, output: await tool.run(parsed.data, ctx) }
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, output: { error: error.message } }
    console.error(`[bot] falló la herramienta ${name}`, error)
    return {
      ok: false,
      output: { error: "Hubo un problema al consultar el sistema. Pedí disculpas y ofrecé pasarle con una persona." },
    }
  }
}

export type { ToolContext }
