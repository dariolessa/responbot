import type { Role } from "@/lib/db/schema"

/*
 * Permisos por rol (docs/SPEC.md, "Roles"). Se revisan en el servidor en cada
 * página y server action; ocultar un botón no alcanza.
 */
export const permissions = {
  /** Ver la agenda y los clientes de todo el equipo. */
  viewAllAgenda: ["owner", "admin"],
  /** Tomar y responder conversaciones. */
  handleConversations: ["owner", "admin", "staff"],
  manageServices: ["owner", "admin"],
  /** Catálogo aprendido desde la web (propiedades, productos). */
  manageCatalog: ["owner", "admin"],
  manageTeam: ["owner", "admin"],
  manageBot: ["owner", "admin"],
  viewStats: ["owner", "admin"],
  manageBusinessSettings: ["owner", "admin"],
  manageConnections: ["owner", "admin"],
  manageBilling: ["owner"],
  transferOwnership: ["owner"],
  deleteBusiness: ["owner"],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof permissions

export function can(role: Role, permission: Permission): boolean {
  return (permissions[permission] as readonly Role[]).includes(role)
}

export const roleLabels: Record<Role, string> = {
  owner: "Dueño",
  admin: "Admin",
  staff: "Profesional",
}
