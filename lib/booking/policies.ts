import type { bookingStatusEnum } from "@/lib/db/schema"

/*
 * Estados del turno y sus transiciones (docs/SPEC.md, "Estados del turno").
 */

export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number]

export const transitions: Record<BookingStatus, readonly BookingStatus[]> = {
  // El SPEC lista confirmed y expired; el negocio también puede cancelar una retención.
  pending_payment: ["confirmed", "expired", "cancelled"],
  confirmed: ["client_confirmed", "cancelled", "completed", "no_show"],
  client_confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  no_show: [],
  cancelled: [],
  expired: [],
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return transitions[from].includes(to)
}

/** Ocupan el horario (igual que la exclusión gist de la base). */
export const occupyingStatuses = [
  "pending_payment",
  "confirmed",
  "client_confirmed",
  "completed",
  "no_show",
] as const satisfies readonly BookingStatus[]

/** Turnos que todavía pueden moverse o cambiar de estado. */
export const openStatuses = [
  "pending_payment",
  "confirmed",
  "client_confirmed",
] as const satisfies readonly BookingStatus[]

export function isOpen(status: BookingStatus): boolean {
  return (openStatuses as readonly BookingStatus[]).includes(status)
}

export const statusLabels: Record<BookingStatus, string> = {
  pending_payment: "Pendiente de seña",
  confirmed: "Confirmado",
  client_confirmed: "Confirmado por el cliente",
  completed: "Atendido",
  no_show: "No vino",
  cancelled: "Cancelado",
  expired: "Vencido",
}

/** Verbo para el botón que lleva a ese estado. */
export const statusActionLabels: Partial<Record<BookingStatus, string>> = {
  confirmed: "Confirmar",
  client_confirmed: "Confirmó el cliente",
  completed: "Atendido",
  no_show: "No vino",
  cancelled: "Cancelar turno",
}
