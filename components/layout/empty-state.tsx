import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Estado vacío: una frase y una acción (docs/SPEC.md, "Principios de interfaz").
 * Por ejemplo: "Todavía no hay turnos hoy · Crear turno".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center sm:py-24",
        className,
      )}
    >
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h2 className="text-base font-medium">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

/** Acción de un estado vacío que todavía no está implementada. */
export function UpcomingAction({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <span
        aria-disabled="true"
        className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-50 sm:h-9 [&_svg]:size-4"
      >
        {children}
      </span>
      <span className="text-xs text-muted-foreground">Disponible muy pronto</span>
    </span>
  )
}
