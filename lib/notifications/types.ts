import type { Role } from "@/lib/db/schema"

/*
 * Catálogo de avisos para el equipo (docs/SPEC.md, "Notificaciones", tabla
 * "Para el equipo del negocio"): qué canales tiene cada evento, cuáles vienen
 * prendidos y cómo se lee. Sin dependencias del servidor: lo usa también la
 * pantalla de preferencias.
 */

export const channels = ["in_app", "push", "whatsapp", "email"] as const
export type Channel = (typeof channels)[number]

export const channelLabels: Record<Channel, string> = {
  in_app: "En el panel",
  push: "Push",
  whatsapp: "WhatsApp",
  email: "Correo",
}

export type BookingPayload = {
  bookingId: string
  customerName: string
  serviceName: string
  staffName: string
  /** Día del turno (AAAA-MM-DD) para abrir la agenda en esa fecha. */
  date: string
  /** "martes 3 de noviembre" y "10:30", ya en la zona del negocio. */
  day: string
  time: string
}

export type NotificationPayloads = {
  "booking.created": BookingPayload & { byBot: boolean; awaitingDeposit?: boolean }
  "booking.changed": BookingPayload & { change: "cancelled" | "rescheduled"; byCustomer: boolean }
  "booking.unconfirmed": BookingPayload
  "conversation.handoff": {
    conversationId: string
    customerId: string
    customerName: string | null
    reason: string
    test: boolean
  }
  "summary.daily": { date: string; bookings: number; firstTime: string | null; botBookings: number }
  "summary.weekly": {
    weekStart: string
    weekEnd: string
    bookings: number
    completed: number
    noShows: number
    revenue: string
    botBookings: number
  }
  "whatsapp.disconnected": { status: "token_expired" | "disconnected" }
  "deposit.paid": BookingPayload & { amount: string }
  "mercadopago.disconnected": Record<string, never>
  "team.invitation_accepted": { memberName: string; roleLabel: string }
}

export type NotificationType = keyof NotificationPayloads

type Defaults = Record<Channel, boolean>

export type NotificationDefinition = {
  label: string
  /** Canales que tiene este evento (el resto no se ofrece). */
  channels: readonly Channel[]
  /** Valores por defecto según el rol; sin preferencia guardada, rigen estos. */
  defaults: (role: Role) => Defaults
  /** Las horas de silencio no lo frenan (derivaciones, resúmenes programados). */
  ignoresQuietHours?: boolean
  /** Los profesionales lo reciben si es de un turno suyo. */
  forStaff?: boolean
}

const off: Defaults = { in_app: false, push: false, whatsapp: false, email: false }

export const notificationTypes: Record<NotificationType, NotificationDefinition> = {
  "booking.created": {
    label: "Reserva nueva",
    channels: ["in_app", "push", "whatsapp"],
    defaults: () => ({ ...off, in_app: true, push: true }),
    forStaff: true,
  },
  "booking.changed": {
    label: "Reserva cancelada o reprogramada",
    channels: ["in_app", "push", "whatsapp"],
    defaults: () => ({ ...off, in_app: true, push: true }),
    forStaff: true,
  },
  "booking.unconfirmed": {
    label: "Cliente que no confirmó a 2 horas del turno",
    channels: ["in_app", "push"],
    defaults: () => ({ ...off, in_app: true, push: true }),
    forStaff: true,
  },
  "conversation.handoff": {
    label: "Conversación que necesita una persona",
    channels: ["in_app", "push", "whatsapp"],
    defaults: (role) => ({ ...off, in_app: true, push: true, whatsapp: role === "owner" }),
    ignoresQuietHours: true,
  },
  "summary.daily": {
    label: "Resumen diario (8:00)",
    channels: ["whatsapp", "email"],
    defaults: (role) => ({ ...off, whatsapp: role === "owner" }),
    ignoresQuietHours: true,
  },
  "summary.weekly": {
    label: "Resumen semanal (lunes 8:00)",
    channels: ["email"],
    defaults: () => off,
    ignoresQuietHours: true,
  },
  "whatsapp.disconnected": {
    label: "WhatsApp desconectado",
    channels: ["in_app", "push", "email"],
    defaults: () => ({ ...off, in_app: true, push: true, email: true }),
  },
  "deposit.paid": {
    label: "Seña pagada",
    channels: ["in_app"],
    defaults: () => ({ ...off, in_app: true }),
    forStaff: true,
  },
  "mercadopago.disconnected": {
    label: "Mercado Pago desconectado",
    channels: ["in_app", "email"],
    defaults: () => ({ ...off, in_app: true, email: true }),
  },
  "team.invitation_accepted": {
    label: "Invitación aceptada",
    channels: ["in_app"],
    defaults: () => ({ ...off, in_app: true }),
  },
}

export const notificationTypeList = Object.keys(notificationTypes) as NotificationType[]

export function isNotificationType(value: string): value is NotificationType {
  return value in notificationTypes
}

export type RenderedNotification = { title: string; body: string; url: string }

function bookingLine(p: BookingPayload) {
  return `${p.customerName}: ${p.serviceName} con ${p.staffName}, ${p.day} a las ${p.time}.`
}

/** Título, texto y destino de un aviso (bandeja, push y correo). */
export function renderNotification<T extends NotificationType>(
  type: T,
  payload: NotificationPayloads[T],
): RenderedNotification {
  switch (type) {
    case "booking.created": {
      const p = payload as NotificationPayloads["booking.created"]
      return {
        title: p.byBot ? "Reserva nueva por WhatsApp" : "Reserva nueva",
        body: p.awaitingDeposit ? `${bookingLine(p)} Espera la seña.` : bookingLine(p),
        url: `/app/agenda?fecha=${p.date}`,
      }
    }
    case "booking.changed": {
      const p = payload as NotificationPayloads["booking.changed"]
      const who = p.byCustomer ? " por el cliente" : ""
      return {
        title: p.change === "cancelled" ? `Turno cancelado${who}` : `Turno reprogramado${who}`,
        body:
          p.change === "cancelled"
            ? bookingLine(p)
            : `${p.customerName}: ${p.serviceName} con ${p.staffName}, ahora el ${p.day} a las ${p.time}.`,
        url: `/app/agenda?fecha=${p.date}`,
      }
    }
    case "booking.unconfirmed": {
      const p = payload as NotificationPayloads["booking.unconfirmed"]
      return {
        title: "Turno sin confirmar",
        body: `${p.customerName} no confirmó su turno de las ${p.time} (${p.serviceName} con ${p.staffName}).`,
        url: `/app/agenda?fecha=${p.date}`,
      }
    }
    case "conversation.handoff": {
      const p = payload as NotificationPayloads["conversation.handoff"]
      return {
        title: p.test ? "Derivación en el chat de prueba" : "Un cliente necesita una persona",
        body: `${p.customerName ?? "Un cliente"}: ${p.reason}`,
        url: p.test ? "/app/bot" : `/app/conversaciones/${p.conversationId}`,
      }
    }
    case "summary.daily": {
      const p = payload as NotificationPayloads["summary.daily"]
      return {
        title: "Resumen del día",
        body:
          p.bookings > 0
            ? `Hoy hay ${p.bookings} ${p.bookings === 1 ? "turno" : "turnos"}; el primero es a las ${p.firstTime}. Desde ayer el bot tomó ${p.botBookings} ${p.botBookings === 1 ? "reserva" : "reservas"}.`
            : `Hoy no hay turnos. Desde ayer el bot tomó ${p.botBookings} ${p.botBookings === 1 ? "reserva" : "reservas"}.`,
        url: "/app/agenda",
      }
    }
    case "summary.weekly": {
      const p = payload as NotificationPayloads["summary.weekly"]
      return {
        title: "Resumen de la semana",
        body: `${p.bookings} turnos, ${p.completed} atendidos, ${p.noShows} inasistencias, ${p.revenue} estimados. El bot tomó ${p.botBookings}.`,
        url: "/app/estadisticas",
      }
    }
    case "whatsapp.disconnected":
      return {
        title: "WhatsApp se desconectó",
        body: "El bot dejó de responder. Volvé a conectar WhatsApp desde Configuración.",
        url: "/app/configuracion#whatsapp",
      }
    case "deposit.paid": {
      const p = payload as NotificationPayloads["deposit.paid"]
      return {
        title: "Seña pagada",
        body: `${p.customerName} pagó ${p.amount} de seña: ${p.serviceName} con ${p.staffName}, ${p.day} a las ${p.time}.`,
        url: `/app/agenda?fecha=${p.date}`,
      }
    }
    case "mercadopago.disconnected":
      return {
        title: "Mercado Pago se desconectó",
        body: "No se pueden cobrar señas: los turnos nuevos se confirman sin seña. Volvé a conectar Mercado Pago desde Configuración.",
        url: "/app/configuracion#mercadopago",
      }
    case "team.invitation_accepted": {
      const p = payload as NotificationPayloads["team.invitation_accepted"]
      return {
        title: "Se sumó alguien al equipo",
        body: `${p.memberName} aceptó la invitación como ${p.roleLabel.toLowerCase()}.`,
        url: "/app/equipo",
      }
    }
  }
  return { title: "Aviso", body: "", url: "/app/notificaciones" }
}

/** "22:00"–"08:00": ¿el minuto del día cae en el silencio? El rango puede cruzar la medianoche. */
export function isQuietTime(minuteOfDay: number, quietStart: string, quietEnd: string): boolean {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const start = toMinutes(quietStart)
  const end = toMinutes(quietEnd)
  if (start === end) return false
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end
}
