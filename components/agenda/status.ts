import type { BookingStatus } from "@/lib/booking/policies"

/*
 * Colores de los estados (docs/SPEC.md, "Diseño"): pendiente de seña ámbar,
 * confirmado esmeralda, confirmado por cliente esmeralda con tilde, atendido
 * gris, no vino rojo suave, cancelado gris tachado.
 */
export const statusBlockClass: Record<BookingStatus, string> = {
  pending_payment:
    "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-50",
  confirmed:
    "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700/70 dark:bg-emerald-950/50 dark:text-emerald-50",
  client_confirmed:
    "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-50",
  completed:
    "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300",
  no_show:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200",
  cancelled:
    "border-zinc-200 bg-zinc-50 text-zinc-500 line-through dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
  expired:
    "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
}

export const statusDotClass: Record<BookingStatus, string> = {
  pending_payment: "bg-amber-500",
  confirmed: "bg-emerald-500",
  client_confirmed: "bg-emerald-600",
  completed: "bg-zinc-400",
  no_show: "bg-red-400",
  cancelled: "bg-zinc-300 dark:bg-zinc-600",
  expired: "bg-zinc-300 dark:bg-zinc-600",
}
