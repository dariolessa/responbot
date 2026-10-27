import type { BookingStatus } from "@/lib/booking/policies"

/** Datos serializados que el servidor le pasa a la agenda. */

export type AgendaView = "dia" | "semana" | "lista"

export type AgendaResource = {
  id: string
  name: string
  color: string
  /** Tramos del horario semanal (weekday 0 = domingo). */
  hours: { weekday: number; startMin: number; endMin: number }[]
  serviceIds: string[]
}

export type AgendaBooking = {
  id: string
  resourceId: string
  serviceId: string
  customerId: string
  customerName: string
  customerPhone: string
  serviceName: string
  status: BookingStatus
  /** Día y minutos desde la medianoche, en la zona del negocio. */
  date: string
  startMin: number
  endMin: number
  startsAt: string
  price: string
  depositStatus: "none" | "pending" | "paid" | "refunded"
  /** Monto de la seña ya formateado, o null si no lleva. */
  deposit: string | null
  source: "whatsapp" | "panel" | "test_chat"
  cancelReason: string | null
}

export type AgendaTimeOff = {
  id: string
  resourceId: string | null
  reason: string | null
  /** Parte del bloqueo que cae en cada día visible. */
  segments: { date: string; startMin: number; endMin: number }[]
  label: string
}

export type AgendaService = {
  id: string
  name: string
  durationMinutes: number
  price: string
  /** Seña que lleva el servicio (si Mercado Pago está conectado), o null. */
  deposit: string | null
}

export type AgendaData = {
  view: AgendaView
  date: string
  today: string
  dates: string[]
  nowMin: number
  timezone: string
  canManageAll: boolean
  /** Un profesional sin columna asignada no ve agenda. */
  hasOwnColumn: boolean
  slotStep: number
  resources: AgendaResource[]
  bookings: AgendaBooking[]
  timeOff: AgendaTimeOff[]
  services: AgendaService[]
  /** Bloqueos de hoy en adelante, para la lista de la hoja de bloqueos. */
  upcomingTimeOff: { id: string; resourceId: string | null; label: string; reason: string | null }[]
  /** Filtro de profesional en semana y lista. */
  resourceFilter: string | null
}
