import {
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  CreditCard,
  MessagesSquare,
  Scissors,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

import type { Permission } from "@/lib/auth/roles"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Si se define, el ítem solo se muestra a roles con ese permiso. */
  permission?: Permission
  /** Va en la barra inferior del celular; el resto queda en "Más". */
  mobile?: boolean
}

/** Secciones del panel (docs/SPEC.md, "Panel y agenda"). */
export const navItems: NavItem[] = [
  { href: "/app/agenda", label: "Agenda", icon: CalendarDays, mobile: true },
  { href: "/app/conversaciones", label: "Conversaciones", icon: MessagesSquare, mobile: true },
  { href: "/app/clientes", label: "Clientes", icon: UsersRound, mobile: true },
  { href: "/app/servicios", label: "Servicios", icon: Scissors, permission: "manageServices" },
  { href: "/app/equipo", label: "Equipo", icon: Users, permission: "manageTeam" },
  { href: "/app/estadisticas", label: "Estadísticas", icon: BarChart3, permission: "viewStats" },
  { href: "/app/bot", label: "Bot", icon: Bot, permission: "manageBot" },
  { href: "/app/notificaciones", label: "Notificaciones", icon: Bell },
  { href: "/app/configuracion", label: "Configuración", icon: Settings },
  { href: "/app/facturacion", label: "Facturación", icon: CreditCard, permission: "manageBilling" },
]
